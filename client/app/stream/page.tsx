"use client";
import { useEffect, useRef, useState } from "react";
import { Device } from "mediasoup-client";

export default function StreamPage() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const producerTransportRef = useRef<any>(null);
  const consumerTransportRef = useRef<any>(null);
  const producerRef = useRef<any>(null);
  const consumerRef = useRef<any>(null);
  const [status, setStatus] = useState("Connecting...");

  useEffect(() => {
    initializeConnection();

    return () => {
      cleanupConnection();
    };
  }, []);

  const initializeConnection = async () => {
    try {
      
      wsRef.current = new WebSocket("ws://localhost:8080");
      deviceRef.current = new Device();

      wsRef.current.onopen = () => {
        setStatus("Connected to signaling server");
        
        wsRef.current?.send(
          JSON.stringify({
            type: "get-router-capabilities",
          })
        );
      };

      wsRef.current.onmessage = async (event) => {
        try {
          let messageData = event.data;

          if (messageData instanceof Blob) {
            messageData = await messageData.text();
          }

          const data = JSON.parse(messageData);
          console.log("Received message:", data);

          switch (data.type) {
            case "router-capabilities":
              await handleRouterCapabilities(data.rtpCapabilities);
              break;
            case "transport-created":
              await handleTransportCreated(data.direction, data);
              break;
            case "transport-connected":
              setStatus("Transport connected");
              break;
            case "producer-created":
              await handleProducerCreated(data.id);
              break;
            case "new-producer":
              await handleNewProducer(data.producerId, data.kind);
              break;
            case "consumer-created":
              await handleConsumerCreated(data);
              break;
            case "consumer-resumed":
              setStatus("Call connected!");
              break;
            case "error":
              setStatus(`Error: ${data.message}`);
              break;
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
          setStatus("Message parsing error");
        }
      };

      wsRef.current.onerror = (error) => {
        console.error("WebSocket error:", error);
        setStatus("WebSocket connection error");
      };

      wsRef.current.onclose = (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
        setStatus("Connection closed");
      };
    } catch (error) {
      console.error("Initialization error:", error);
      setStatus(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  };

  const handleRouterCapabilities = async (rtpCapabilities: any) => {
    if (!deviceRef.current) return;

    try {
      await deviceRef.current.load({ routerRtpCapabilities: rtpCapabilities });
      setStatus("Device loaded, creating transports...");

      // Create producer transport (for sending our media)
      wsRef.current?.send(
        JSON.stringify({
          type: "create-transport",
          direction: "send",
        })
      );

      // Create consumer transport (for receiving remote media)
      wsRef.current?.send(
        JSON.stringify({
          type: "create-transport",
          direction: "recv",
        })
      );
    } catch (error) {
      console.error("Error loading device:", error);
    }
  };

  const handleTransportCreated = async (direction: string, data: any) => {
    if (!deviceRef.current) return;

    const transport =
      direction === "send"
        ? deviceRef.current.createSendTransport(data)
        : deviceRef.current.createRecvTransport(data);

    if (direction === "send") {
      producerTransportRef.current = transport;

      transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
        try {
          wsRef.current?.send(
            JSON.stringify({
              type: "connect-transport",
              transportId: transport.id,
              dtlsParameters,
            })
          );
          callback();
        } catch (error) {
          errback(error instanceof Error ? error : new Error(String(error)));
        }
      });

      transport.on("produce", async (parameters, callback, errback) => {
        try {
          wsRef.current?.send(
            JSON.stringify({
              type: "produce",
              transportId: transport.id,
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
            })
          );
          callback({
            id:
              parameters.kind === "video" ? "video-producer" : "audio-producer",
          });
        } catch (error) {
          errback(error instanceof Error ? error : new Error(String(error)));
        }
      });

      // Start producing after transport is created
      await startProducing();
    } else {
      consumerTransportRef.current = transport;

      transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
        try {
          wsRef.current?.send(
            JSON.stringify({
              type: "connect-transport",
              transportId: transport.id,
              dtlsParameters,
            })
          );
          callback();
        } catch (error) {
          errback(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }
  };

  const startProducing = async () => {
    if (!producerTransportRef.current) {
      console.error("Producer transport not available");
      return;
    }

    try {
      console.log("Requesting user media...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      console.log("Got user media stream:", stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log("Set local video source");
      }

      // Check if we have video tracks
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length === 0) {
        throw new Error("No video tracks available");
      }

      // Produce video track
      const videoTrack = videoTracks[0];
      console.log("Creating video producer...");
      producerRef.current = await producerTransportRef.current.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: 100000, scaleResolutionDownBy: 4 },
          { maxBitrate: 300000, scaleResolutionDownBy: 2 },
          { maxBitrate: 900000, scaleResolutionDownBy: 1 },
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000,
        },
      });
      console.log("Video producer created:", producerRef.current.id);

      setStatus("Streaming - waiting for viewers...");
    } catch (error) {
      console.error("Error starting production:", error);
      setStatus(
        `Media error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const handleProducerCreated = async (producerId: string) => {
    console.log("Producer created with ID:", producerId);
  };

  const handleNewProducer = async (producerId: string, kind: string) => {
    if (!consumerTransportRef.current) {
      console.log("Consumer transport not ready, waiting...");
      // Retry after a short delay
      setTimeout(() => handleNewProducer(producerId, kind), 500);
      return;
    }

    console.log(`Handling new producer: ${producerId} of kind: ${kind}`);
    setStatus("Connecting to peer...");

    // Start consuming the remote producer
    wsRef.current?.send(
      JSON.stringify({
        type: "consume",
        transportId: consumerTransportRef.current.id,
        producerId,
      })
    );
  };

  const handleConsumerCreated = async (data: any) => {
    if (!deviceRef.current || !consumerTransportRef.current) {
      console.error("Device or consumer transport not available");
      return;
    }

    console.log("Creating consumer for producer:", data.producerId);

    try {
      const consumer = await consumerTransportRef.current.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      consumerRef.current = consumer;
      console.log("Consumer created successfully:", consumer.id);

      // Create a new stream for the remote track
      const stream = new MediaStream();
      stream.addTrack(consumer.track);

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        console.log("Remote video stream set");
      }

      // Notify server we're ready to resume
      wsRef.current?.send(
        JSON.stringify({
          type: "resume-consumer",
          consumerId: consumer.id,
        })
      );
    } catch (error) {
      console.error("Error creating consumer:", error);
      setStatus(
        `Consumer error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  const cleanupConnection = () => {
    if (producerRef.current) {
      producerRef.current.close();
    }
    if (consumerRef.current) {
      consumerRef.current.close();
    }
    if (producerTransportRef.current) {
      producerTransportRef.current.close();
    }
    if (consumerTransportRef.current) {
      consumerTransportRef.current.close();
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (localVideoRef.current?.srcObject) {
      (localVideoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach((track) => track.stop());
    }
    if (remoteVideoRef.current?.srcObject) {
      (remoteVideoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach((track) => track.stop());
    }
  };

  return (
    <div className="h-screen w-full flex justify-center items-center">
      <div style={{ padding: "20px" }}>
        <h1>Video Call: {status}</h1>
        <div style={{ display: "flex", gap: "20px", marginTop: "20px" }}>
          <div>
            <h3>You (Local)</h3>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={{
                width: "400px",
                height: "300px",
                backgroundColor: "#000",
                border: "2px solid #ccc",
                borderRadius: "8px",
              }}
            />
          </div>
          <div>
            <h3>Peer (Remote)</h3>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{
                width: "400px",
                height: "300px",
                backgroundColor: "#000",
                border: "2px solid #ccc",
                borderRadius: "8px",
              }}
            />
          </div>
        </div>
        <div style={{ marginTop: "20px" }}>
          <button
            onClick={() => {
              console.log("=== DEBUG INFO ===");
              console.log("WebSocket:", wsRef.current?.readyState);
              console.log("Device:", deviceRef.current);
              console.log("Producer Transport:", producerTransportRef.current);
              console.log("Consumer Transport:", consumerTransportRef.current);
              console.log("Producer:", producerRef.current);
              console.log("Consumer:", consumerRef.current);
              console.log("Local video element:", localVideoRef.current);
              console.log("Remote video element:", remoteVideoRef.current);
              console.log(
                "Local video srcObject:",
                localVideoRef.current?.srcObject
              );
              console.log(
                "Remote video srcObject:",
                remoteVideoRef.current?.srcObject
              );
              console.log("=== END DEBUG ===");
            }}
            style={{
              padding: "10px 20px",
              backgroundColor: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              marginRight: "10px",
            }}
          >
            Debug Info
          </button>
          <button
            onClick={() => {
              cleanupConnection();
              setTimeout(() => {
                initializeConnection();
              }, 1000);
            }}
            style={{
              padding: "10px 20px",
              backgroundColor: "#28a745",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Reconnect
          </button>
        </div>
      </div>
    </div>
  );
}
