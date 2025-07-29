"use client";
import { useEffect, useRef, useState } from "react";

export default function WatchPage() {
  const [streams, setStreams] = useState<string[]>([]);
  const [status, setStatus] = useState("Loading...");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initializeMultiStreamPlayer();
    const interval = setInterval(checkForNewStreams, 3000);
    return () => clearInterval(interval);
  }, []);

  const checkForNewStreams = async () => {
    try {
      const availableStreams: string[] = [];

      for (let i = 1; i <= 5; i++) {
        try {
          const response = await fetch(
            `http://localhost:8080/hls/user${i}.m3u8`,
            {
              method: "HEAD",
              signal: AbortSignal.timeout(3000),
            }
          );
          if (response.ok) {
            const streamUrl = `http://localhost:8080/hls/user${i}.m3u8`;
            if (!availableStreams.includes(streamUrl)) {
              availableStreams.push(streamUrl);
            }
          }
        } catch (e) {
          // Stream doesn't exist
        }
      }

      if (availableStreams.length !== streams.length) {
        setStreams(availableStreams);
        if (availableStreams.length > 0) {
          setStatus(`Live - ${availableStreams.length} user(s) streaming`);
          setIsLoading(false);
        } else {
          setStatus("Waiting for users to start streaming...");
        }
      }
    } catch (error) {
      setStatus("Error scanning for streams");
    }
  };

  const initializeMultiStreamPlayer = async () => {
    try {
      setStatus("Scanning for live streams...");
      setError(null);
      await checkForNewStreams();
    } catch (error) {
      setError(
        "Failed to find live streams. Make sure users are streaming on /stream"
      );
      setStatus("No streams found");
      setIsLoading(false);
    }
  };

  const handleRefresh = () => {
    setIsLoading(true);
    setError(null);
    setStreams([]);
    initializeMultiStreamPlayer();
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="bg-gray-800 p-6 shadow-lg">
        <h1 className="text-3xl font-bold text-center">Live Stream Viewer</h1>
        <div className="text-center mt-2">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              streams.length > 0
                ? "bg-green-100 text-green-800"
                : error
                ? "bg-red-100 text-red-800"
                : "bg-yellow-100 text-yellow-800"
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full mr-2 ${
                streams.length > 0
                  ? "bg-green-500"
                  : error
                  ? "bg-red-500"
                  : "bg-yellow-500"
              }`}
            ></div>
            {status}
          </span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-5xl">
          {isLoading && (
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
              <p className="text-lg">Scanning for live streams...</p>
            </div>
          )}

          {error && !isLoading && (
            <div className="text-center p-6">
              <div className="text-red-400 text-xl mb-4">⚠️</div>
              <h3 className="text-lg font-semibold mb-2">
                No Live Streams Found
              </h3>
              <p className="text-gray-300 mb-4">{error}</p>
              <button
                onClick={handleRefresh}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {streams.length > 0 && (
            <div className="space-y-6">
              <div className="relative bg-black rounded-lg overflow-hidden shadow-2xl">
                <div className="aspect-video bg-black relative">
                  <div
                    className={`absolute inset-0 ${getLayoutClass(
                      streams.length
                    )}`}
                  >
                    {streams.map((streamUrl, index) => (
                      <CompositeStreamPlayer
                        key={streamUrl}
                        streamUrl={streamUrl}
                        userIndex={index + 1}
                        totalUsers={streams.length}
                      />
                    ))}
                  </div>

                  <div className="absolute top-4 left-4 bg-red-600 text-white px-3 py-1 rounded-full text-sm font-bold flex items-center z-20">
                    <div className="w-2 h-2 bg-white rounded-full mr-2 animate-pulse"></div>
                    LIVE
                  </div>

                  <div className="absolute top-4 right-4 bg-black bg-opacity-75 text-white px-3 py-1 rounded text-sm z-20">
                    {streams.length} user{streams.length > 1 ? "s" : ""}{" "}
                    streaming
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-4 justify-center">
            <button
              onClick={handleRefresh}
              className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              🔄 Refresh Stream
            </button>

            <button
              onClick={() => {
                const player = document.querySelector(".aspect-video");
                if (player) {
                  if (document.fullscreenElement) {
                    document.exitFullscreen();
                  } else {
                    player.requestFullscreen();
                  }
                }
              }}
              className="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg font-medium transition-colors"
            >
              🖥️ Fullscreen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getLayoutClass(userCount: number): string {
  switch (userCount) {
    case 1:
      return "grid grid-cols-1";
    case 2:
      return "grid grid-cols-2";
    case 3:
      return "grid grid-cols-3";
    case 4:
      return "grid grid-cols-2 grid-rows-2";
    default:
      return "grid grid-cols-2 grid-rows-2";
  }
}

function CompositeStreamPlayer({
  streamUrl,
  userIndex,
  totalUsers,
}: {
  streamUrl: string;
  userIndex: number;
  totalUsers: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playerStatus, setPlayerStatus] = useState("Loading...");

  useEffect(() => {
    initializeHlsPlayer();
  }, [streamUrl]);

  const initializeHlsPlayer = async () => {
    if (!videoRef.current) return;

    try {
      setPlayerStatus("Connecting...");

      if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
        videoRef.current.src = streamUrl;
        setPlayerStatus("Live");
      } else {
        try {
          const HlsModule = await import("hls.js");
          const Hls = HlsModule.default || HlsModule;

          if (Hls && Hls.isSupported && Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              backBufferLength: 90,
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
            });

            hls.loadSource(streamUrl);
            hls.attachMedia(videoRef.current);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              setPlayerStatus("Live");
              videoRef.current?.play().catch(() => {});
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
              if (data?.fatal) {
                setPlayerStatus("Error");
                try {
                  hls.destroy();
                  setTimeout(() => {
                    initializeHlsPlayer();
                  }, 2000);
                } catch (e) {}
              }
            });

            return () => {
              try {
                hls.destroy();
              } catch (e) {}
            };
          } else {
            throw new Error("HLS.js not supported");
          }
        } catch (hlsError) {
          setPlayerStatus("Unsupported");
        }
      }
    } catch (error) {
      setPlayerStatus("Failed");
    }
  };

  return (
    <div className="relative w-full h-full bg-gray-900">
      {totalUsers > 1 && (
        <div className="absolute top-2 left-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs z-10">
          User {userIndex}
        </div>
      )}

      {playerStatus !== "Live" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 z-10">
          <div className="text-center text-white">
            {playerStatus === "Loading..." && (
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
            )}
            <p className="text-sm">{playerStatus}</p>
          </div>
        </div>
      )}

      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        autoPlay
        muted
        playsInline
        style={{
          backgroundColor: "#1f2937",
        }}
        onLoadStart={() => setPlayerStatus("Loading...")}
        onCanPlay={() => setPlayerStatus("Live")}
        onPlaying={() => setPlayerStatus("Live")}
        onWaiting={() => setPlayerStatus("Buffering...")}
        onError={() => setPlayerStatus("Error")}
      />
    </div>
  );
}
