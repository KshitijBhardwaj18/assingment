import { spawn, ChildProcess } from "child_process";
import fs from "fs";

export function startHlsTranscoder(
  rtpConfig: {
    ip: string;
    port: number;
    payloadType: number;
    codecName?: string;
  },
  outputDir: string
): ChildProcess {

  try {
    const { execSync } = require("child_process");
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch (error) {
    throw new Error(
      
    );
  }

  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  
  const sdpContent = generateSdpFile(rtpConfig);
  const sdpPath = `${outputDir}/stream.sdp`;
  fs.writeFileSync(sdpPath, sdpContent);
  console.log(`Generated SDP file: ${sdpPath}`);

  
  const isLowResource = process.env.LOW_RESOURCE === "true";

  const baseArgs = [
    "-protocol_whitelist",
    "file,udp,rtp",
    "-f",
    "sdp",
    "-i",
    sdpPath, 
    "-c:v",
    "libx264",
  ];

  
  const optimizedArgs = isLowResource
    ? [
        
        "-preset",
        "ultrafast", 
        "-tune",
        "zerolatency", 
        "-crf",
        "28", 
        "-s",
        "640x480", 
        "-r",
        "15",
        "-maxrate",
        "500k",
        "-bufsize",
        "1M",
        "-g",
        "30",
        "-threads",
        "1",
      ]
    : [
        "-preset",
        "fast",
        "-tune",
        "zerolatency",
        "-crf",
        "23",
        "-s",
        "1280x720",
        "-r",
        "30",
        "-maxrate",
        "2M",
        "-bufsize",
        "4M",
        "-g",
        "60",
        "-threads",
        "2",
      ];

  const hlsArgs = [
    "-f",
    "hls",
    "-hls_time",
    isLowResource ? "4" : "2",
    "-hls_list_size",
    "3",
    "-hls_flags",
    "delete_segments",
    "-hls_segment_filename",
    `${outputDir}/segment%03d.ts`,
    `${outputDir}/playlist.m3u8`,
  ];

  const ffmpegArgs = [...baseArgs, ...optimizedArgs, ...hlsArgs];

  console.log(
    `Starting FFmpeg with ${isLowResource ? "LOW RESOURCE" : "NORMAL"} settings`
  );
  console.log("FFmpeg command:", "ffmpeg", ffmpegArgs.join(" "));
  console.log(`Listening for RTP on ${rtpConfig.ip}:${rtpConfig.port}`);

  const ffmpeg = spawn("ffmpeg", ffmpegArgs);

  ffmpeg.stdout?.on("data", (data) => {
    console.log(`FFmpeg stdout: ${data}`);
  });

  ffmpeg.stderr?.on("data", (data) => {
    console.log(`FFmpeg stderr: ${data}`);
  });

  ffmpeg.on("close", (code) => {
    console.log(`FFmpeg process exited with code ${code}`);
  });

  ffmpeg.on("error", (error) => {
    console.error("FFmpeg error:", error);
  });

  return ffmpeg;
}

function generateSdpFile(rtpConfig: {
  ip: string;
  port: number;
  payloadType: number;
  codecName?: string;
}): string {
  const codecName = rtpConfig.codecName || "VP8";
  const clockRate = codecName === "H264" ? "90000" : "90000";

  return `v=0
o=- 0 0 IN IP4 ${rtpConfig.ip}
s=MediaSoup Stream
t=0 0
m=video ${rtpConfig.port} RTP/AVP ${rtpConfig.payloadType}
c=IN IP4 ${rtpConfig.ip}
a=rtpmap:${rtpConfig.payloadType} ${codecName}/${clockRate}
a=sendonly
`;
}
