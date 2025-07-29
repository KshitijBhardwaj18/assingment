import * as mediasoup from "mediasoup";

export async function createMediasoupWorker() {
  const worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
  });

  worker.on("died", () => {
    console.error("Mediasoup worker died");
    process.exit(1);
  });

  return worker;
}
