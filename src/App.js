import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dropdown,
  Input,
  message,
  Space,
  Spin,
  Upload,
  Card,
} from "antd";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  UploadOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ScissorOutlined,
} from "@ant-design/icons";
import "antd/dist/reset.css";
import "./App.css";

const ffmpeg = new FFmpeg();

function formatTime(seconds) {
  if (isNaN(seconds) || seconds === 0) return "00:00";
  const mins = Math.floor(Math.abs(seconds) / 60);
  const secs = Math.floor(Math.abs(seconds) % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

const TrackGrid = ({ totalDuration }) => {
  const ticks = [];
  let interval = 1;
  if (totalDuration > 60 * 5) interval = 30;
  else if (totalDuration > 60 * 2) interval = 10;
  else if (totalDuration > 60) interval = 5;
  else if (totalDuration > 30) interval = 2;

  for (let i = 0; i < totalDuration; i += interval) {
    const left = (i / totalDuration) * 100;
    if (left > 100) continue;
    ticks.push(
      <div key={i} className="track-grid-tick" style={{ left: `${left}%` }} />
    );
  }
  return <div className="track-grid">{ticks}</div>;
};

const SIDEBAR_WIDTH = 140;

function App() {
  const [ready, setReady] = useState(false);
  const [mediaPool, setMediaPool] = useState([]);
  const [timelineClips, setTimelineClips] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(30);
  const [numTracks, setNumTracks] = useState(1);
  const [mediaPoolWidth, setMediaPoolWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const [trimming, setTrimming] = useState(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [dropPlaceholder, setDropPlaceholder] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const mouseXRef = useRef(0);
  const resizeData = useRef({ startX: 0, startWidth: 0 });
  const animationFrameRef = useRef(null);

  const dragStartData = useRef(null);
  const trimData = useRef(null);

  useEffect(() => {
    const load = async () => {
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          "text/javascript"
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          "application/wasm"
        ),
      });
      setReady(true);
    };
    load();
  }, []);

  useEffect(() => {
    const captureMouse = (e) => {
      mouseXRef.current = e.clientX;
    };
    window.addEventListener("mousemove", captureMouse);
    return () => {
      window.removeEventListener("mousemove", captureMouse);
    };
  }, []);
  const addToPool = (file) => {
    const url = URL.createObjectURL(file);
    const clip = {
      id: Date.now() + Math.random(),
      name: file.name,
      url,
      file,
      duration: 15, // fallback so clip has visible width immediately
    };
    setMediaPool((prev) => [...prev, clip]);
  };

  const updateDuration = (id, duration) => {
    setMediaPool((p) =>
      p.map((c) => (c.id === id ? { ...c, duration: duration || 15 } : c))
    );
    // Only update timeline clips that haven't been trimmed/split yet.
    setTimelineClips((prev) =>
      prev.map((c) => {
        if (c.id === id && c.duration === c.trimmedDuration) {
          return {
            ...c,
            duration: duration || 15,
            trimmedDuration: duration || 15,
          };
        }
        // Also update the base duration for all clips from this source
        if (c.id === id) {
          return { ...c, duration: duration || 15 };
        }
        return c;
      })
    );
  };

  const addClipToTrack = (sourceClip, trackIndex, startTime = 0) => {
    const newClip = {
      ...sourceClip,
      timelineId: `${Date.now()}-${Math.random()}`,
      trackIndex,
      startTime,
      sourceTrimStart: 0,
      trim: [0, 100],
      trimmedDuration: sourceClip.duration || 15,
    };
    setTimelineClips((prev) => [...prev, newClip]);
  };

  const createTrackMenu = (trackIndex) => ({
    items:
      mediaPool.length === 0
        ? [{ key: "empty", label: "No videos in Media Pool", disabled: true }]
        : mediaPool.map((clip) => ({
            key: clip.id.toString(),
            label: `${clip.name.slice(0, 30)} (${formatTime(clip.duration)})`,
          })),
    onClick: ({ key }) => {
      const clip = mediaPool.find((c) => c.id.toString() === key);
      if (clip) {
        addClipToTrack(clip, trackIndex, 0);
        message.success(`${clip.name} added to V${trackIndex + 1}`);
      }
    },
  });

  const splitClip = (timelineClip, e) => {
    e.stopPropagation();
    const clipElement = e.currentTarget;
    const rect = clipElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));

    const splitLocal = percentage * timelineClip.trimmedDuration;

    if (splitLocal <= 0.5 || splitLocal >= timelineClip.trimmedDuration - 0.5)
      return;

    const leftDur = splitLocal;
    const rightDur = timelineClip.trimmedDuration - splitLocal;

    const leftClip = {
      ...timelineClip,
      timelineId: `${Date.now()}-${Math.random()}`,
      trimmedDuration: leftDur,
    };

    const rightClip = {
      ...timelineClip,
      timelineId: `${Date.now()}-${Math.random() + 1}`,
      startTime: timelineClip.startTime + leftDur,
      sourceTrimStart: timelineClip.sourceTrimStart + leftDur,
      trimmedDuration: rightDur,
    };

    setTimelineClips((prev) =>
      prev
        .filter((c) => c.timelineId !== timelineClip.timelineId)
        .concat([leftClip, rightClip])
    );
  };

  const splitClipAtPlayhead = () => {
    const activeClips = timelineClips.filter(
      (c) =>
        currentTime > c.startTime &&
        currentTime < c.startTime + c.trimmedDuration
    );

    if (activeClips.length === 0) {
      message.warning("Playhead is not over a clip to split.");
      return;
    }

    activeClips.sort((a, b) => b.trackIndex - a.trackIndex);
    const clipToSplit = activeClips[0];

    const splitLocal = currentTime - clipToSplit.startTime;

    const leftDur = splitLocal;
    const rightDur = clipToSplit.trimmedDuration - splitLocal;

    const leftClip = {
      ...clipToSplit,
      timelineId: `${Date.now()}-${Math.random()}`,
      trimmedDuration: leftDur,
    };

    const rightClip = {
      ...clipToSplit,
      timelineId: `${Date.now()}-${Math.random() + 1}`,
      startTime: clipToSplit.startTime + leftDur,
      sourceTrimStart: clipToSplit.sourceTrimStart + leftDur,
      trimmedDuration: rightDur,
    };

    setTimelineClips((prev) =>
      prev
        .filter((c) => c.timelineId !== clipToSplit.timelineId)
        .concat([leftClip, rightClip])
    );
  };
  const removeTrack = (trackIndexToRemove) => {
    setTimelineClips((prev) =>
      prev
        .filter((c) => c.trackIndex !== trackIndexToRemove)
        .map((c) => {
          if (c.trackIndex > trackIndexToRemove) {
            return { ...c, trackIndex: c.trackIndex - 1 };
          }
          return c;
        })
    );
    setNumTracks((n) => n - 1);
  };

  const onDragStart = (start) => {
    const { source, draggableId } = start;
    if (source.droppableId.startsWith("track-")) {
      const draggedClip = timelineClips.find(
        (c) => c.timelineId.toString() === draggableId
      );
      if (draggedClip && timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect();
        const x = mouseXRef.current - rect.left - SIDEBAR_WIDTH;
        const clickTime = (x / (rect.width - SIDEBAR_WIDTH)) * totalDuration;
        const offset = clickTime - draggedClip.startTime;
        dragStartData.current = { offset };
      }
    } else {
      dragStartData.current = null;
    }
  };
  const onDragEnd = (result) => {
    setDropPlaceholder(null);
    if (!result.destination) return;

    const { source, destination, draggableId } = result;

    if (
      source.droppableId === "media-pool" &&
      destination.droppableId.startsWith("track-")
    ) {
      const clip = mediaPool[result.source.index];
      const trackIndex = parseInt(result.destination.droppableId.split("-")[1]);

      let startTime = 0;
      if (timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect();
        const x = mouseXRef.current - rect.left - SIDEBAR_WIDTH;
        const percentage = Math.max(
          0,
          Math.min(1, x / (rect.width - SIDEBAR_WIDTH))
        );
        startTime = percentage * totalDuration;
      }
      addClipToTrack(clip, trackIndex, startTime);
      message.success(`${clip.name} added to V${trackIndex + 1}`);
    } else if (
      source.droppableId.startsWith("track-") &&
      destination.droppableId.startsWith("track-")
    ) {
      const destTrackIndex = parseInt(destination.droppableId.split("-")[1]);

      setTimelineClips((prev) =>
        prev.map((c) => {
          if (c.timelineId.toString() === draggableId) {
            let newStartTime = c.startTime; // Default to original start time
            if (timelineRef.current && dragStartData.current) {
              const rect = timelineRef.current.getBoundingClientRect();
              const x = mouseXRef.current - rect.left - SIDEBAR_WIDTH;
              const dropTime =
                (x / (rect.width - SIDEBAR_WIDTH)) * totalDuration;
              const offset = dragStartData.current.offset || 0;
              newStartTime = Math.max(0, dropTime - offset);
            }
            return {
              ...c,
              trackIndex: destTrackIndex,
              startTime: newStartTime,
            };
          }
          return c;
        })
      );
    }
  };
  const onDragUpdate = (update) => {
    const { source, destination, draggableId } = update;
    if (!destination || !destination.droppableId.startsWith("track-")) {
      setDropPlaceholder(null);
      return;
    }

    const trackIndex = parseInt(destination.droppableId.split("-")[1]);

    let clipDuration;
    if (source.droppableId === "media-pool") {
      const clip = mediaPool[source.index];
      clipDuration = clip.duration;
    } else {
      const clip = timelineClips.find(
        (c) => c.timelineId.toString() === draggableId
      );
      if (clip) {
        clipDuration = clip.trimmedDuration;
      }
    }

    if (!clipDuration) return;

    if (timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const x = mouseXRef.current - rect.left - SIDEBAR_WIDTH;
      const percentage = Math.max(
        0,
        Math.min(1, x / (rect.width - SIDEBAR_WIDTH))
      );
      let dropTime = percentage * totalDuration;

      // If dragging from timeline, apply the offset to find the clip's start time
      if (source.droppableId.startsWith("track-") && dragStartData.current) {
        const offset = dragStartData.current.offset || 0;
        dropTime = Math.max(0, dropTime - offset);
      }

      const placeholderWidth = (clipDuration / totalDuration) * 100;

      setDropPlaceholder({
        trackIndex,
        startTime: dropTime,
        width: placeholderWidth,
      });
    }
  };

  useEffect(() => {
    const getActiveClip = () => {
      const activeClips = timelineClips.filter(
        (clip) =>
          currentTime >= clip.startTime &&
          currentTime < clip.startTime + clip.trimmedDuration
      );

      if (activeClips.length === 0) {
        return null;
      }

      // Sort by trackIndex descending to find the top-most clip
      activeClips.sort((a, b) => b.trackIndex - a.trackIndex);
      const topClip = activeClips[0];

      const localTime = currentTime - topClip.startTime;
      const seekTo = localTime + (topClip.sourceTrimStart || 0);
      return { url: topClip.url, seekTo };
    };

    if (videoRef.current) {
      const active = getActiveClip();
      if (active) {
        videoRef.current.src = active.url;
        videoRef.current.currentTime = active.seekTo;
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
      }
    }
  }, [currentTime, timelineClips]);

  useEffect(() => {
    const max = timelineClips.reduce((currentMax, clip) => {
      const clipEnd = clip.startTime + clip.trimmedDuration;
      return Math.max(currentMax, clipEnd);
    }, 30);
    setTotalDuration(Math.max(max, 30));
  }, [timelineClips]);

  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  useEffect(() => {
    const loop = (time) => {
      animationFrameRef.current = requestAnimationFrame(loop);
      setCurrentTime((prevTime) => {
        const newTime =
          prevTime + (time - (animationFrameRef.lastTime || 0)) / 1000;
        animationFrameRef.lastTime = time;
        if (newTime >= totalDuration) {
          setIsPlaying(false);
          return totalDuration;
        }
        return newTime;
      });
    };

    if (isPlaying) {
      animationFrameRef.lastTime = performance.now();
      animationFrameRef.current = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(animationFrameRef.current);
    }

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, totalDuration]);

  const handleResizeMouseDown = (e) => {
    e.preventDefault();
    resizeData.current = {
      startX: e.clientX,
      startWidth: mediaPoolWidth,
    };
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      const dx = e.clientX - resizeData.current.startX;
      const newWidth = resizeData.current.startWidth + dx;
      if (newWidth > 200 && newWidth < 800) {
        setMediaPoolWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      setIsResizing(false);
    };
    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const handleTrimMouseDown = (e, clip, handle) => {
    e.stopPropagation();
    e.preventDefault();
    setTrimming({ clipId: clip.timelineId, handle });
    trimData.current = {
      startX: e.clientX,
      originalClip: { ...clip },
      timelineWidth: timelineRef.current.getBoundingClientRect().width,
    };
  };

  useEffect(() => {
    if (!trimming) return;

    const handleMouseMove = (e) => {
      const dx = e.clientX - trimData.current.startX;
      const { originalClip, timelineWidth } = trimData.current;
      const timeDelta = (dx / timelineWidth) * totalDuration;

      setTimelineClips((prev) =>
        prev.map((c) => {
          if (c.timelineId !== trimming.clipId) return c;

          if (trimming.handle === "end") {
            const newDuration = originalClip.trimmedDuration + timeDelta;
            const maxDuration =
              originalClip.duration - originalClip.sourceTrimStart;
            const newTrimmedDuration = Math.max(
              1,
              Math.min(newDuration, maxDuration)
            );
            return { ...c, trimmedDuration: newTrimmedDuration };
          } else {
            // 'start'
            const newStartTime = originalClip.startTime + timeDelta;
            const newSourceTrimStart = originalClip.sourceTrimStart + timeDelta;
            const newTrimmedDuration = originalClip.trimmedDuration - timeDelta;

            if (
              newTrimmedDuration < 1 ||
              newSourceTrimStart < 0 ||
              newSourceTrimStart > originalClip.duration - 1
            ) {
              return c; // Invalid trim, return original
            }

            return {
              ...c,
              startTime: newStartTime,
              trimmedDuration: newTrimmedDuration,
              sourceTrimStart: newSourceTrimStart,
            };
          }
        })
      );
    };

    const handleMouseUp = () => {
      setTrimming(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [trimming, totalDuration]);

  const handleSeekMouseDown = (e) => {
    const targetClassList = e.target.classList;
    if (
      targetClassList.contains("timeline-panel") ||
      targetClassList.contains("ruler") ||
      targetClassList.contains("ruler-tick") ||
      targetClassList.contains("track") ||
      targetClassList.contains("track-clips") ||
      targetClassList.contains("playhead")
    ) {
      e.preventDefault();
      setIsSeeking(true);
      if (isPlaying) {
        setIsPlaying(false);
      }

      if (timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left - SIDEBAR_WIDTH;
        const percentage = Math.max(
          0,
          Math.min(1, x / (rect.width - SIDEBAR_WIDTH))
        );
        setCurrentTime(percentage * totalDuration);
      }
    }
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isSeeking || !timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - SIDEBAR_WIDTH;
      const percentage = Math.max(
        0,
        Math.min(1, x / (rect.width - SIDEBAR_WIDTH))
      );
      setCurrentTime(
        Math.min(totalDuration, Math.max(0, percentage * totalDuration))
      );
    };

    const handleMouseUp = () => {
      setIsSeeking(false);
    };

    if (isSeeking) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isSeeking, totalDuration]);

  const Ruler = ({ totalDuration }) => {
    // ... implementation inside App or move to its own file
    const ticks = [];
    let interval = 1;
    if (totalDuration > 60 * 5) interval = 30;
    else if (totalDuration > 60 * 2) interval = 10;
    else if (totalDuration > 60) interval = 5;
    else if (totalDuration > 30) interval = 2;

    for (let i = 0; i < totalDuration; i += interval) {
      const left = (i / totalDuration) * 100;
      if (left > 100) continue;
      ticks.push(
        <div key={i} className="ruler-tick" style={{ left: `${left}%` }}>
          <span className="ruler-label">{formatTime(i)}</span>
        </div>
      );
    }
    return <div className="ruler">{ticks}</div>;
  };

  return (
    <Spin spinning={!ready} tip="Loading FFmpeg...">
      <style>{`
        .layout {
          display: flex;
          height: calc(100vh - 200px);
        }
        .media-bin {
          flex-shrink: 0;
        }
        .resizer {
          width: 5px;
          cursor: col-resize;
          background: #222;
          flex-shrink: 0;
        }
        .resizer:hover {
          background: #444;
        }
        .timeline-clip .trim-handle {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 10px;
          cursor: col-resize;
          z-index: 10;
        }
        .timeline-clip .trim-handle.start { left: 0; }
        .timeline-clip .trim-handle.end { right: 0; }
        .drop-placeholder {
          position: absolute;
          top: 0;
          bottom: 0;
          height: 100%;
          background: rgba(0, 150, 255, 0.4);
          border: 1px dashed #09f;
          z-index: 40;
          pointer-events: none;
          border-radius: 4px;
        }
        .timeline-clip {
          position: absolute;
        }
        .ruler {
          position: relative;
          height: 30px;
          background: #2a2a2a;
          border-bottom: 1px solid #444;
        }
        .track {
          display: flex;
          align-items: stretch;
        }
        .track-label {
          width: ${SIDEBAR_WIDTH}px;
          min-width: ${SIDEBAR_WIDTH}px;
          padding: 0 10px;
          border-right: 1px solid #444;
        }
        .track-clips {
          flex: 1;
          position: relative;
        }
        .ruler-tick {
          position: absolute;
          height: 100%;
          width: 1px;
          background: #555;
        }
        .ruler-tick::before {
          content: '';
          position: absolute;
          top: 15px;
          height: 15px;
          width: 1px;
          background: #888;
        }
        .ruler-label {
          position: absolute;
          top: 0;
          left: 2px;
          color: #aaa;
          font-size: 10px;
        }
        .playhead {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background-color: red;
          z-index: 50;
          cursor: ew-resize;
          transform: translateX(-1px);
          pointer-events: auto;
        }
        .playhead::before {
          content: '';
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 14px solid red;
        }
        .track-grid {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          pointer-events: none;
        }
        .track-grid-tick {
          position: absolute;
          top: 0; bottom: 0;
          width: 1px;
          background-color: rgba(255, 255, 255, 0.1);
        }
      `}</style>
      <DragDropContext
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        onDragUpdate={onDragUpdate}
      >
        <div className="editor">
          <div className="header">
            <h1>Pro Video Editor</h1>
            <Space>
              <Upload
                accept="video/*"
                showUploadList={false}
                beforeUpload={(f) => {
                  addToPool(f);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />}>Upload Video</Button>
              </Upload>
              <Button type="primary" icon={<DownloadOutlined />}>
                Export (Soon)
              </Button>
            </Space>
          </div>

          <div className="layout">
            <div className="media-bin" style={{ width: mediaPoolWidth }}>
              <h3>Media Pool ({mediaPool.length})</h3>
              <Droppable droppableId="media-pool">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="pool-list"
                  >
                    {mediaPool.map((clip, i) => (
                      <Draggable
                        key={clip.id}
                        draggableId={clip.id.toString()}
                        index={i}
                      >
                        {(provided, snapshot) => (
                          <Card
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            hoverable
                            style={{
                              ...provided.draggableProps.style,
                              opacity: snapshot.isDragging ? 0.7 : 1,
                            }}
                            bodyStyle={{ padding: "8px" }}
                            cover={
                              <video
                                src={clip.url}
                                muted
                                onLoadedMetadata={(e) =>
                                  updateDuration(clip.id, e.target.duration)
                                }
                                style={{
                                  height: "60px",
                                  objectFit: "cover",
                                  background: "#000",
                                }}
                              />
                            }
                          >
                            <Card.Meta
                              title={
                                <span style={{ fontSize: "12px" }}>
                                  {clip.name.slice(0, 25)}
                                </span>
                              }
                              description={
                                <span style={{ fontSize: "10px" }}>
                                  {formatTime(clip.duration)}
                                </span>
                              }
                            />
                          </Card>
                        )}
                      </Draggable>
                    ))}
                  </div>
                )}
              </Droppable>
            </div>

            <div className="resizer" onMouseDown={handleResizeMouseDown} />

            <div className="preview-panel">
              <video ref={videoRef} className="preview-video" />
              <div className="time-display">
                {formatTime(currentTime)} / {formatTime(totalDuration)}
              </div>
              <div className="preview-controls">
                <Space>
                  <Button
                    onClick={togglePlay}
                    icon={
                      isPlaying ? (
                        <PauseCircleOutlined />
                      ) : (
                        <PlayCircleOutlined />
                      )
                    }
                  >
                    {isPlaying ? "Pause" : "Play"}
                  </Button>
                  <Button
                    onClick={splitClipAtPlayhead}
                    icon={<ScissorOutlined />}
                  >
                    Split
                  </Button>
                </Space>
              </div>
            </div>
          </div>

          <div
            className="timeline-panel"
            ref={timelineRef}
            onMouseDown={handleSeekMouseDown}
          >
            <div style={{ marginLeft: SIDEBAR_WIDTH }}>
              <Ruler totalDuration={totalDuration} />
            </div>

            {Array.from({ length: numTracks }, (_, trackIndex) => (
              <Droppable
                key={trackIndex}
                droppableId={`track-${trackIndex}`}
              >
                {(provided, snapshot) => (
                  <div
                    className={`track ${
                      snapshot.isDraggingOver ? "dragging-over" : ""
                    }`}
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                  >
                    <div className="track-label">
                      <Space size="small" align="center">
                        <span style={{ fontWeight: "bold" }}>
                          V{trackIndex + 1}
                        </span>
                        <Dropdown
                          menu={createTrackMenu(trackIndex)}
                          trigger={["click"]}
                          disabled={mediaPool.length === 0}
                        >
                          <Button
                            type="text"
                            icon={<PlusOutlined />}
                            size="small"
                            style={{ color: "#fff" }}
                          />
                        </Dropdown>
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          size="small"
                          style={{ color: "#fff" }}
                          onClick={() => removeTrack(trackIndex)}
                          disabled={numTracks <= 1}
                        />
                      </Space>
                    </div>
                    <div className="track-clips">
                      <TrackGrid totalDuration={totalDuration} />
                      {timelineClips
                        .filter((c) => c.trackIndex === trackIndex)
                        .map((clip, i) => (
                          <Draggable
                            key={clip.timelineId}
                            draggableId={clip.timelineId.toString()}
                            index={i}
                          >
                            {(provided, snapshot) => {
                              const style = {
                                ...provided.draggableProps.style,
                                width: `${
                                  (clip.trimmedDuration / totalDuration) * 100
                                }%`,
                                minWidth: "80px",
                              };
                              if (!snapshot.isDragging) {
                                style.left = `${
                                  (clip.startTime / totalDuration) * 100
                                }%`;
                              } else {
                                style.transition = "none";
                              }
                              return (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className="timeline-clip"
                                  style={style}
                                  onDoubleClick={(e) => splitClip(clip, e)}
                                >
                                  <div
                                    className="trim-handle start"
                                    onMouseDown={(e) =>
                                      handleTrimMouseDown(e, clip, "start")
                                    }
                                  />
                                  <span>{clip.name.slice(0, 12)}</span>
                                  <div
                                    className="trim-handle end"
                                    onMouseDown={(e) =>
                                      handleTrimMouseDown(e, clip, "end")
                                    }
                                  />
                                </div>
                              );
                            }}
                          </Draggable>
                        ))}
                      {provided.placeholder}
                      {snapshot.isDraggingOver &&
                        dropPlaceholder &&
                        dropPlaceholder.trackIndex === trackIndex && (
                          <div
                            className="drop-placeholder"
                            style={{
                              left: `${
                                (dropPlaceholder.startTime / totalDuration) *
                                100
                              }%`,
                              width: `${dropPlaceholder.width}%`,
                            }}
                          />
                        )}
                    </div>
                  </div>
                )}
              </Droppable>
            ))}

            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: SIDEBAR_WIDTH,
                right: 0,
                pointerEvents: "none",
              }}
            >
              <div
                className="playhead"
                style={{ left: `${(currentTime / totalDuration) * 100}%` }}
                onMouseDown={handleSeekMouseDown}
              />
            </div>
            <Button
              onClick={() => setNumTracks((n) => n + 1)}
              style={{ margin: "20px 0" }}
            >
              + Add Video Track
            </Button>
          </div>
        </div>
      </DragDropContext>
    </Spin>
  );
}

export default App;
