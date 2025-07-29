import WebSocket from "ws";
import { IncomingMessage } from "http";
import { createMediasoupWorker } from "./mediaSoup";
import { startHlsTranscoder } from "./hls-transcode";
import { types as mediasoupTypes } from "mediasoup";

interface Peer {
  id: string;
  ws: WebSocket;
  transports: { [key: string]: mediasoupTypes.WebRtcTransport | null };
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
}

export class WSSignalingServer {
  private wss: WebSocket.Server;
  private worker!: mediasoupTypes.Worker;
  private router!: mediasoupTypes.Router;
  private room: Map<string, Peer> = new Map();
  private hlsProducers: Map<
    string,
    {
      plainTransport: mediasoupTypes.PlainTransport;
      consumer: mediasoupTypes.Consumer;
      port: number;
    }
  > = new Map();

  constructor(serverOptions: WebSocket.ServerOptions) {
    this.wss = new WebSocket.Server(serverOptions);
    this.initialize().then(() => {
      this.setupConnectionHandlers();
    });
  }

  private async initialize() {
    this.worker = await createMediasoupWorker();
    this.router = await this.worker.createRouter({
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/H264",
          clockRate: 90000,
          parameters: {
            "packetization-mode": 1,
            "profile-level-id": "42e01f",
            "level-asymmetry-allowed": 1,
          },
        },
      ],
    });
  }

  private async createPlainTransportForProducer(
    producerId: string,
    targetPort: number
  ) {
    const plainTransport = await this.router.createPlainTransport({
      listenIp: { ip: "127.0.0.1", announcedIp: undefined },
      rtcpMux: true,
      comedia: false,
      enableSrtp: false,
      srtpCryptoSuite: undefined,
      maxSctpMessageSize: 262144,
      sctpSendBufferSize: 1048576,
    });

    await plainTransport.connect({
      ip: "127.0.0.1",
      port: targetPort,
    });

    return plainTransport;
  }

  private async startHlsForProducer(producer: mediasoupTypes.Producer) {
    if (producer.kind !== "video") {
      return;
    }

    try {
      const userIndex = this.hlsProducers.size + 1;
      const port = 5004 + this.hlsProducers.size * 2;

      const plainTransport = await this.createPlainTransportForProducer(
        producer.id,
        port
      );

      const consumer = await plainTransport.consume({
        producerId: producer.id,
        rtpCapabilities: this.router.rtpCapabilities,
        paused: false,
      });

      this.hlsProducers.set(producer.id, {
        plainTransport,
        consumer,
        port: port,
      });

      await this.startIndividualUserFFmpeg(producer.id, port, userIndex);
    } catch (error) {

    }
  }

  private async startIndividualUserFFmpeg(
    producerId: string,
    port: number,
    userIndex: number
  ) {
    const { spawn } = require("child_process");
    const fs = require("fs");

    const hlsProducer = this.hlsProducers.get(producerId);
    if (!hlsProducer) return;

    const codec = hlsProducer.consumer.rtpParameters.codecs[0];
    const codecName = codec.mimeType.split("/")[1];

    const sdpContent = this.generateSdpForProducer(
      port,
      codec.payloadType,
      codecName
    );
    const sdpPath = `./public/hls/user${userIndex}.sdp`;
    fs.writeFileSync(sdpPath, sdpContent);

    const outputFile = `./public/hls/user${userIndex}.m3u8`;

    const args = [
      "-y",
      "-protocol_whitelist",
      "file,udp,rtp",
      "-max_delay",
      "500000",
      "-f",
      "sdp",
      "-i",
      sdpPath,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "25",
      "-s",
      "640x480",
      "-r",
      "30",
      "-f",
      "hls",
      "-hls_time",
      "3",
      "-hls_list_size",
      "5",
      "-hls_flags",
      "delete_segments",
      "-hls_segment_filename",
      `./public/hls/user${userIndex}_segment%03d.ts`,
      outputFile,
    ];

    const ffmpeg = spawn("ffmpeg", args);

    ffmpeg.stderr?.on("data", (data: any) => {
      const output = data.toString();
      if (output.includes("Error") || output.includes("failed")) {
        // Silent error logging
      }
    });
  }

  private generateSdpForProducer(
    port: number,
    payloadType: number,
    codecName: string
  ): string {
    let codecMapping = "";
    const codecUpper = codecName.toUpperCase();

    if (codecUpper === "VP8") {
      codecMapping = `a=rtpmap:${payloadType} VP8/90000`;
    } else if (codecUpper === "VP9") {
      codecMapping = `a=rtpmap:${payloadType} VP9/90000`;
    } else if (codecUpper === "H264") {
      codecMapping = `a=rtpmap:${payloadType} H264/90000\na=fmtp:${payloadType} profile-level-id=42e01f`;
    } else {
      codecMapping = `a=rtpmap:${payloadType} ${codecName}/90000`;
    }

    return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=MediaSoup Producer Stream
c=IN IP4 127.0.0.1
t=0 0
m=video ${port} RTP/AVP ${payloadType}
${codecMapping}
a=sendonly
`;
  }

  private removeProducerFromHls(producerId: string) {
    const hlsProducer = this.hlsProducers.get(producerId);
    if (hlsProducer) {
      hlsProducer.consumer.close();
      hlsProducer.plainTransport.close();
      this.hlsProducers.delete(producerId);
    }
  }

  private setupConnectionHandlers() {
    this.wss.on("connection", (ws: WebSocket) => {
      const peerId = `peer-${Date.now()}`;

      const peer: Peer = {
        ws,
        id: peerId,
        transports: {},
        producers: new Map(),
        consumers: new Map(),
      };

      this.room.set(peerId, peer);

      ws.on("message", (message: string) => {
        this.handleMessage(peer, message).catch(() => {});
      });

      setTimeout(() => {
        this.notifyAboutExistingProducers(peer);
      }, 1000);

      ws.on("close", () => {
        this.handleDisconnect(peerId);
      });

      ws.on("error", (error) => {
        this.handleDisconnect(peerId);
      });
    });
  }

  private async handleMessage(peer: Peer, message: string) {
    const data = JSON.parse(message);

    try {
      switch (data.type) {
        case "get-router-capabilities":
          peer.ws.send(
            JSON.stringify({
              type: "router-capabilities",
              rtpCapabilities: this.router.rtpCapabilities,
            })
          );
          break;

        case "create-transport":
          await this.handleCreateTransport(peer, data.direction);
          break;

        case "connect-transport":
          await this.handleConnectTransport(
            peer,
            data.transportId,
            data.dtlsParameters
          );
          break;

        case "produce":
          await this.handleProduce(
            peer,
            data.transportId,
            data.kind,
            data.rtpParameters
          );
          break;

        case "consume":
          await this.handleConsume(peer, data.transportId, data.producerId);
          break;

        case "resume-consumer":
          await this.handleResumeConsumer(peer, data.consumerId);
          break;
      }
    } catch (error) {
      peer.ws.send(
        JSON.stringify({
          type: "error",
          message: "Request failed",
        })
      );
    }
  }

  private async handleCreateTransport(peer: Peer, direction: "send" | "recv") {
    const transport = await this.router.createWebRtcTransport({
      listenIps: [{ ip: "0.0.0.0", announcedIp: "127.0.0.1" }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    peer.transports[direction] = transport;

    peer.ws.send(
      JSON.stringify({
        type: "transport-created",
        direction,
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      })
    );

    return transport;
  }

  private async handleConnectTransport(
    peer: Peer,
    transportId: string,
    dtlsParameters: any
  ) {
    const transport = Object.values(peer.transports).find(
      (t) => t?.id === transportId
    );

    if (!transport) throw new Error("Transport not found");

    await transport.connect({ dtlsParameters });

    peer.ws.send(
      JSON.stringify({
        type: "transport-connected",
        transportId,
      })
    );
  }

  private async handleProduce(
    peer: Peer,
    transportId: string,
    kind: string,
    rtpParameters: any
  ) {
    const transport = peer.transports.send;
    if (!transport || transport.id !== transportId) {
      throw new Error("Send transport not found");
    }

    const producer = await transport.produce({
      kind: kind as "audio" | "video",
      rtpParameters,
    });

    producer.on("transportclose", () => {
      producer.close();
      peer.producers.delete(producer.id);

      if (kind === "video") {
        this.removeProducerFromHls(producer.id);
      }
    });

    peer.producers.set(producer.id, producer);

    if (kind === "video") {
      await this.startHlsForProducer(producer);
    }

    this.room.forEach((otherPeer) => {
      if (otherPeer.id !== peer.id) {
        otherPeer.ws.send(
          JSON.stringify({
            type: "new-producer",
            producerId: producer.id,
            kind,
          })
        );
      }
    });

    peer.ws.send(
      JSON.stringify({
        type: "producer-created",
        id: producer.id,
      })
    );
  }

  private async handleConsume(
    peer: Peer,
    transportId: string,
    producerId: string
  ) {
    const transport = peer.transports.recv;
    if (!transport || transport.id !== transportId) {
      throw new Error("Receive transport not found");
    }

    const producer = Array.from(this.room.values())
      .flatMap((p) => Array.from(p.producers.values()))
      .find((p) => p.id === producerId);

    if (!producer) throw new Error("Producer not found");

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities: this.router.rtpCapabilities,
      paused: true,
    });

    consumer.on("transportclose", () => {
      consumer.close();
      peer.consumers.delete(consumer.id);
    });

    peer.consumers.set(consumer.id, consumer);

    peer.ws.send(
      JSON.stringify({
        type: "consumer-created",
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      })
    );
  }

  private async handleResumeConsumer(peer: Peer, consumerId: string) {
    const consumer = peer.consumers.get(consumerId);
    if (!consumer) throw new Error("Consumer not found");

    await consumer.resume();
    peer.ws.send(
      JSON.stringify({
        type: "consumer-resumed",
        consumerId,
      })
    );
  }

  private handleDisconnect(peerId: string) {
    const peer = this.room.get(peerId);
    if (!peer) return;

    Object.values(peer.transports).forEach((transport) => transport?.close());
    peer.producers.forEach((producer) => producer.close());
    peer.consumers.forEach((consumer) => consumer.close());

    this.room.delete(peerId);
  }

  private notifyAboutExistingProducers(newPeer: Peer) {
    this.room.forEach((otherPeer) => {
      if (otherPeer.id !== newPeer.id) {
        otherPeer.producers.forEach((producer, producerId) => {
          newPeer.ws.send(
            JSON.stringify({
              type: "new-producer",
              producerId: producer.id,
              kind: producer.kind,
            })
          );
        });
      }
    });
  }

  public close() {
    this.wss.close();
    this.room.forEach((peer) => this.handleDisconnect(peer.id));
    this.worker?.close();
  }
}
