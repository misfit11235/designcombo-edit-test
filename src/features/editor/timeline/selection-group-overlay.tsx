import { useEffect, useState, useRef } from "react";
import { filter, subject, dispatch } from "@designcombo/events";
import useStore from "../store/use-store";
import { timeMsToUnits, unitsToTimeMs } from "@designcombo/timeline";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLAYER_SEEK, PLAYER_PLAY, PLAYER_PAUSE } from "../constants/events";
import { getCurrentTime } from "../utils/time";

interface SelectionMarker {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  groupId: string;
  videoItemId?: string; // Track which video item this marker belongs to
}

interface DragState {
  markerId: string;
  type: "move" | "resize-left" | "resize-right";
  startX: number;
  startLeft: number;
  startWidth: number;
}

const SelectionGroupOverlay = () => {
  const { timeline, scale, scroll, fps, setScale, setScroll } = useStore();
  const [markers, setMarkers] = useState<SelectionMarker[]>([]);
  const [videoTrackInfo, setVideoTrackInfo] = useState<{
    top: number;
    height: number;
    videoItemId: string;
  } | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const originalTimeRef = useRef<number | null>(null);
  const [verticalScroll, setVerticalScroll] = useState(0);
  const [currentGroupName, setCurrentGroupName] = useState<string>("");
  const [originalMarkers, setOriginalMarkers] = useState<SelectionMarker[]>([]);
  const [hasModifications, setHasModifications] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState("");
  const [selectedMarkerIds, setSelectedMarkerIds] = useState<string[]>([]);
  const [isSequentialPlaying, setIsSequentialPlaying] = useState(false);
  const sequentialPlayStateRef = useRef<{
    currentIndex: number;
    sortedMarkers: SelectionMarker[];
    isPausing: boolean;
  } | null>(null);

  // Zoom state for pause-to-zoom feature
  const pauseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastDragPositionRef = useRef<{ x: number; time: number } | null>(null);
  const originalZoomStateRef = useRef<{
    zoom: number;
    scrollLeft: number;
  } | null>(null);
  const isZoomedRef = useRef(false);

  // Get video track position and clear markers if video is deleted
  useEffect(() => {
    if (!timeline) return;

    const updateVideoTrack = () => {
      const allObjects = timeline.getObjects();
      const videoItems = allObjects.filter(
        (obj: any) => obj.type === "Video" || obj.itemType === "video"
      );

      if (videoItems.length === 0) {
        // No video items found - clear markers and video track info
        setMarkers([]);
        setVideoTrackInfo(null);
        return false;
      }

      const topVideoItem = videoItems.reduce((topmost: any, current: any) => {
        return current.top < topmost.top ? current : topmost;
      }, videoItems[0]);

      setVideoTrackInfo({
        top: topVideoItem.top,
        height: topVideoItem.height || 100,
        videoItemId: topVideoItem.id,
      });

      return true;
    };

    // Listen for object removal events
    const handleObjectRemoved = (e: any) => {
      const removedObject = e.target;

      // Check if the removed object is the video that markers are attached to
      if (videoTrackInfo && removedObject.id === videoTrackInfo.videoItemId) {
        // The video track we're attached to was deleted - clear everything
        setMarkers([]);
        setVideoTrackInfo(null);
      } else {
        // Some other object was removed, update track info
        updateVideoTrack();
      }
    };

    timeline.on("object:removed", handleObjectRemoved);

    // Try immediately
    if (!updateVideoTrack()) {
      // If no video items found, retry a few times
      let attempts = 0;
      const interval = setInterval(() => {
        if (updateVideoTrack() || attempts++ > 10) {
          clearInterval(interval);
        }
      }, 100);

      return () => {
        timeline.off("object:removed", handleObjectRemoved);
        clearInterval(interval);
      };
    }

    return () => {
      timeline.off("object:removed", handleObjectRemoved);
    };
  }, [timeline, markers.length]);

  // Listen for load selection group events
  useEffect(() => {
    const subscription = subject
      .pipe(filter(({ key }) => key === "LOAD_SELECTION_GROUP"))
      .subscribe((event: any) => {
        const groupData = event.value?.payload;
        if (!groupData) return;

        // Store the original group name
        setCurrentGroupName(groupData.name || "");

        // Parse timeframes
        let timeframes = groupData.timeframes;
        if (typeof timeframes === "string") {
          try {
            timeframes = JSON.parse(timeframes);
          } catch (e) {
            console.error("Failed to parse timeframes:", e);
            return;
          }
        }

        // Clear existing markers first
        setMarkers([]);
        setOriginalMarkers([]);

        // Convert to markers
        const newMarkers: SelectionMarker[] = [];

        if (typeof timeframes === "object" && !Array.isArray(timeframes)) {
          Object.entries(timeframes).forEach(([label, tf]: [string, any]) => {
            const start = Array.isArray(tf) ? tf[0] : tf.start || tf.from || 0;
            const end = Array.isArray(tf) ? tf[1] : tf.end || tf.to || 0;

            newMarkers.push({
              id: `${groupData.id}-${label}`,
              label,
              startMs: start * 1000,
              endMs: end * 1000,
              groupId: groupData.id,
              videoItemId: videoTrackInfo?.videoItemId, // Store which video they belong to
            });
          });
        }

        // Set new markers
        setMarkers(newMarkers);
        setOriginalMarkers(JSON.parse(JSON.stringify(newMarkers))); // Deep copy
        setHasModifications(false);
      });

    return () => subscription.unsubscribe();
  }, [videoTrackInfo]);

  // Listen for save selection group trigger event
  useEffect(() => {
    const subscription = subject
      .pipe(filter(({ key }) => key === "SAVE_SELECTION_GROUP"))
      .subscribe(() => {
        if (markers.length > 0 && hasModifications) {
          handleOpenSaveDialog();
        }
      });

    return () => subscription.unsubscribe();
  }, [markers.length, hasModifications, currentGroupName]);

  // Listen for sequential play trigger from header
  useEffect(() => {
    const subscription = subject
      .pipe(filter(({ key }) => key === "TRIGGER_SEQUENTIAL_PLAY"))
      .subscribe(() => {
        handleSequentialPlay();
      });

    return () => subscription.unsubscribe();
  }, [selectedMarkerIds, markers, isSequentialPlaying]);

  // Listen for delete selected markers trigger from header
  useEffect(() => {
    const subscription = subject
      .pipe(filter(({ key }) => key === "DELETE_SELECTED_MARKERS"))
      .subscribe(() => {
        // Remove selected markers
        const newMarkers = markers.filter(
          (m) => !selectedMarkerIds.includes(m.id)
        );
        setMarkers(newMarkers);
        setSelectedMarkerIds([]);
        toast.success(
          `Deleted ${selectedMarkerIds.length} marker${
            selectedMarkerIds.length > 1 ? "s" : ""
          }`
        );
      });

    return () => subscription.unsubscribe();
  }, [selectedMarkerIds, markers]);

  // Listen for export selected markers
  useEffect(() => {
    console.log("Overlay: Setting up EXPORT_SELECTED_MARKERS listener");

    const subscription = subject
      .pipe(filter(({ key }) => key === "EXPORT_SELECTED_MARKERS"))
      .subscribe(() => {
        console.log("Overlay: Received EXPORT_SELECTED_MARKERS event");
        handleExportMarkers(false);
      });

    return () => subscription.unsubscribe();
  }, [markers, selectedMarkerIds, fps]);

  // Listen for export all markers
  useEffect(() => {
    console.log("Overlay: Setting up EXPORT_ALL_MARKERS listener");

    const subscription = subject
      .pipe(filter(({ key }) => key === "EXPORT_ALL_MARKERS"))
      .subscribe(() => {
        console.log("Overlay: Received EXPORT_ALL_MARKERS event");
        handleExportMarkers(true);
      });

    return () => subscription.unsubscribe();
  }, [markers, fps]);

  // Sync with canvas vertical scroll
  useEffect(() => {
    if (!timeline) return;

    // The timeline canvas has viewportTransform that includes scroll
    const updateScroll = () => {
      const viewportTransform = timeline.viewportTransform;
      if (viewportTransform) {
        // viewportTransform[5] is the vertical translation (negative of scroll position)
        setVerticalScroll(-viewportTransform[5]);
      }
    };

    // Update on timeline events
    timeline.on("after:render", updateScroll);
    updateScroll(); // Initial sync

    return () => {
      timeline.off("after:render", updateScroll);
    };
  }, [timeline]);

  // Handle dragging and resizing
  const handleMouseDown = (
    e: React.MouseEvent,
    markerId: string,
    type: "move" | "resize-left" | "resize-right"
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const marker = markers.find((m) => m.id === markerId);
    if (!marker) return;

    // Store the current playhead time to restore later
    originalTimeRef.current = getCurrentTime();

    // Store the absolute position (including scroll) for accurate calculations
    const left = timeMsToUnits(marker.startMs, scale.zoom) - scroll.left;
    const width = timeMsToUnits(marker.endMs - marker.startMs, scale.zoom);

    dragStateRef.current = {
      markerId,
      type,
      startX: e.clientX,
      startLeft: left,
      startWidth: width,
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragStateRef.current) return;

    const { markerId, type, startX, startLeft, startWidth } =
      dragStateRef.current;
    const deltaX = e.clientX - startX;

    // Track mouse position and detect pause for zoom
    const currentPosition = { x: e.clientX, time: Date.now() };

    // Check if mouse has moved significantly since last check
    const hasMovedSignificantly =
      lastDragPositionRef.current &&
      Math.abs(currentPosition.x - lastDragPositionRef.current.x) > 5;

    // If moved significantly, clear timer and update position
    if (hasMovedSignificantly) {
      console.log("Mouse moved significantly, resetting timer");
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
      lastDragPositionRef.current = currentPosition;
    }

    // If this is first movement or we've stopped moving, start/continue timer
    if (!lastDragPositionRef.current) {
      console.log("Starting pause detection");
      lastDragPositionRef.current = currentPosition;
    }

    // Always set the timer if not already zoomed and only for resize operations
    if (
      !pauseTimerRef.current &&
      !isZoomedRef.current &&
      (type === "resize-left" || type === "resize-right")
    ) {
      console.log("Setting 2-second zoom timer");
      pauseTimerRef.current = setTimeout(() => {
        console.log("Timer fired! Attempting to zoom in");
        if (!timeline || isZoomedRef.current) {
          console.log("Cannot zoom:", {
            hasTimeline: !!timeline,
            isZoomed: isZoomedRef.current,
          });
          return;
        }

        console.log("Zooming in!");

        // Store original zoom and scroll state
        originalZoomStateRef.current = {
          zoom: scale.zoom,
          scrollLeft: scroll.left,
        };

        console.log("Original state stored:", originalZoomStateRef.current);

        // Calculate the time position at the current drag point
        const marker = markers.find((m) => m.id === markerId);
        if (!marker) {
          console.log("Marker not found!");
          return;
        }

        let targetTimeMs: number;
        if (type === "resize-left") {
          targetTimeMs = marker.startMs;
        } else if (type === "resize-right") {
          targetTimeMs = marker.endMs;
        } else {
          targetTimeMs = marker.startMs;
        }

        // Zoom to maximum (10x current zoom)
        const maxZoomValue = scale.zoom * 10;
        const maxUnit = 1 / maxZoomValue;

        console.log("Setting new zoom:", {
          old: scale.zoom,
          new: maxZoomValue,
        });

        // Calculate the current position of the handle in timeline units (before zoom)
        const handlePositionInTimeline = timeMsToUnits(
          targetTimeMs,
          scale.zoom
        );

        // Calculate where the handle appears on screen (relative to timeline container)
        const handleScreenPosition = handlePositionInTimeline - scroll.left;

        // After zoom, calculate new position of the handle in timeline units
        const newHandlePositionInTimeline = timeMsToUnits(
          targetTimeMs,
          maxZoomValue
        );

        // To keep the handle at the same screen position:
        // newHandlePositionInTimeline - newScrollLeft = handleScreenPosition
        // Therefore: newScrollLeft = newHandlePositionInTimeline - handleScreenPosition
        const newScrollLeft =
          newHandlePositionInTimeline - handleScreenPosition;

        console.log("Scroll calculation:", {
          targetTimeMs,
          handlePositionInTimeline,
          handleScreenPosition,
          newHandlePositionInTimeline,
          oldScroll: scroll.left,
          newScroll: newScrollLeft,
        });

        setScale({
          ...scale,
          zoom: maxZoomValue,
          unit: maxUnit,
        });

        setScroll({ left: Math.max(0, newScrollLeft), top: scroll.top });

        isZoomedRef.current = true;
        toast.info("Zoomed in for precise frame selection");
        console.log("Zoom complete!");
      }, 2000);
    }

    let previewTime: number | null = null;

    setMarkers((prev) => {
      // Sort markers by startMs to find adjacent markers
      const sortedMarkers = [...prev].sort((a, b) => a.startMs - b.startMs);
      const currentIndex = sortedMarkers.findIndex((m) => m.id === markerId);
      const currentMarker = sortedMarkers[currentIndex];

      // Find previous and next markers
      const prevMarker =
        currentIndex > 0 ? sortedMarkers[currentIndex - 1] : null;
      const nextMarker =
        currentIndex < sortedMarkers.length - 1
          ? sortedMarkers[currentIndex + 1]
          : null;

      return prev.map((marker) => {
        if (marker.id !== markerId) return marker;

        if (type === "move") {
          const newLeft = startLeft + deltaX;
          // Add scroll.left to convert from screen position to timeline position
          const newStartMs = unitsToTimeMs(newLeft + scroll.left, scale.zoom);
          const duration = marker.endMs - marker.startMs;

          // Constrain to not pass previous or next marker
          let constrainedStartMs = Math.max(0, newStartMs);

          // Can't start before previous marker ends
          if (prevMarker) {
            constrainedStartMs = Math.max(constrainedStartMs, prevMarker.endMs);
          }

          // Can't end after next marker starts
          if (nextMarker) {
            const maxStartMs = nextMarker.startMs - duration;
            constrainedStartMs = Math.min(constrainedStartMs, maxStartMs);
          }

          previewTime = constrainedStartMs;

          return {
            ...marker,
            startMs: constrainedStartMs,
            endMs: constrainedStartMs + duration,
          };
        } else if (type === "resize-left") {
          const newLeft = startLeft + deltaX;
          // Add scroll.left to convert from screen position to timeline position
          const newStartMs = unitsToTimeMs(newLeft + scroll.left, scale.zoom);

          // Constrain to not pass previous marker's end
          let constrainedStartMs = Math.max(0, newStartMs);
          if (prevMarker) {
            constrainedStartMs = Math.max(constrainedStartMs, prevMarker.endMs);
          }

          const finalStartMs = Math.min(constrainedStartMs, marker.endMs - 100);
          previewTime = finalStartMs;

          return {
            ...marker,
            startMs: finalStartMs,
          };
        } else if (type === "resize-right") {
          const newWidth = startWidth + deltaX;
          // Add scroll.left to convert from screen position to timeline position
          const newEndMs = unitsToTimeMs(
            startLeft + newWidth + scroll.left,
            scale.zoom
          );

          // Constrain to not pass next marker's start
          let constrainedEndMs = Math.max(marker.startMs + 100, newEndMs);
          if (nextMarker) {
            constrainedEndMs = Math.min(constrainedEndMs, nextMarker.startMs);
          }

          previewTime = constrainedEndMs;

          return {
            ...marker,
            endMs: constrainedEndMs,
          };
        }

        return marker;
      });
    });

    // Seek to the preview time, rounding to the nearest frame for pixel-perfect alignment
    if (previewTime !== null) {
      // Round to nearest frame to match playhead rendering
      const frame = Math.round((previewTime * fps) / 1000);
      const roundedTime = (frame / fps) * 1000;
      dispatch(PLAYER_SEEK, { payload: { time: roundedTime } });
    }
  };

  const handleMouseUp = () => {
    // Clear any pending zoom timer
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }

    // Restore zoom if we zoomed in
    if (isZoomedRef.current && originalZoomStateRef.current) {
      setScale({
        ...scale,
        zoom: originalZoomStateRef.current.zoom,
        unit: 1 / originalZoomStateRef.current.zoom,
      });
      setScroll({
        left: originalZoomStateRef.current.scrollLeft,
        top: scroll.top,
      });
      originalZoomStateRef.current = null;
      isZoomedRef.current = false;
    }

    if (dragStateRef.current) {
      dragStateRef.current = null;

      // Restore the original playhead position
      if (originalTimeRef.current !== null) {
        dispatch(PLAYER_SEEK, { payload: { time: originalTimeRef.current } });
        originalTimeRef.current = null;
      }
    }

    // Reset pause tracking
    lastDragPositionRef.current = null;

    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  // Check for modifications whenever markers change
  useEffect(() => {
    if (originalMarkers.length === 0 || markers.length === 0) {
      setHasModifications(false);
      // Dispatch state update
      dispatch("SELECTION_GROUP_MODIFICATIONS_CHANGED", {
        payload: { hasModifications: false },
      });
      return;
    }

    // Check if markers have been added or deleted
    const countChanged = markers.length !== originalMarkers.length;

    // Check if any marker positions have changed
    const modified =
      countChanged ||
      markers.some((marker) => {
        const original = originalMarkers.find((m) => m.id === marker.id);
        if (!original) return true;
        return (
          original.startMs !== marker.startMs || original.endMs !== marker.endMs
        );
      });

    setHasModifications(modified);
    // Dispatch state update
    dispatch("SELECTION_GROUP_MODIFICATIONS_CHANGED", {
      payload: { hasModifications: modified },
    });
  }, [markers, originalMarkers]);

  // Handle opening save dialog
  const handleOpenSaveDialog = () => {
    setSaveDialogName(currentGroupName);
    setShowSaveDialog(true);
  };

  // Handle save selection group
  const handleSave = async () => {
    if (!saveDialogName.trim()) {
      return;
    }

    // Convert markers back to timeframes format with start/end objects
    const timeframes: Record<string, { start: number; end: number }> = {};
    markers.forEach((marker) => {
      timeframes[marker.label] = {
        start: marker.startMs / 1000,
        end: marker.endMs / 1000,
      };
    });

    try {
      const response = await fetch("/api/uploads/selection-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveDialogName.trim(),
          timeframes,
        }),
      });

      if (response.ok) {
        // Update original markers to match current state
        setOriginalMarkers(JSON.parse(JSON.stringify(markers)));
        setHasModifications(false);
        setCurrentGroupName(saveDialogName.trim());
        setShowSaveDialog(false);
        toast.success("Selection group saved successfully!");
      } else {
        const error = await response.json();
        toast.error(`Failed to save: ${error.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save selection group");
    }
  };

  // Handle sequential play through markers
  const handleSequentialPlay = () => {
    // If already playing, pause
    if (isSequentialPlaying) {
      setIsSequentialPlaying(false);
      sequentialPlayStateRef.current = null;
      dispatch(PLAYER_PAUSE, { payload: {} });
      dispatch("SEQUENTIAL_PLAY_STATE_CHANGED", {
        payload: { isPlaying: false },
      });
      return;
    }

    // Only work with selected markers
    if (selectedMarkerIds.length === 0) {
      toast.error("No markers selected. Please select at least one marker.");
      return;
    }

    const currentTime = getCurrentTime();

    // Filter only selected markers and sort by start time
    const selectedMarkers = markers.filter((m) =>
      selectedMarkerIds.includes(m.id)
    );
    const sortedMarkers = [...selectedMarkers].sort(
      (a, b) => a.startMs - b.startMs
    );

    // Find the current or next marker to play
    let startIndex = sortedMarkers.findIndex(
      (m) => currentTime >= m.startMs && currentTime <= m.endMs
    );

    // If not in any marker, find the next marker
    if (startIndex === -1) {
      startIndex = sortedMarkers.findIndex((m) => m.startMs > currentTime);
      if (startIndex === -1) startIndex = 0; // Loop back to first
    }

    setIsSequentialPlaying(true);
    sequentialPlayStateRef.current = {
      currentIndex: startIndex,
      sortedMarkers,
      isPausing: false,
    };

    // Start playing from the marker
    const marker = sortedMarkers[startIndex];
    dispatch(PLAYER_SEEK, { payload: { time: marker.startMs } });
    dispatch(PLAYER_PLAY, { payload: {} });
    dispatch("SEQUENTIAL_PLAY_STATE_CHANGED", { payload: { isPlaying: true } });
  };

  // Handle exporting markers to MP4
  const handleExportMarkers = async (exportAll: boolean) => {
    console.log("handleExportMarkers called", {
      exportAll,
      markers,
      selectedMarkerIds,
    });

    const markersToExport = exportAll
      ? markers
      : markers.filter((m) => selectedMarkerIds.includes(m.id));

    console.log("markersToExport:", markersToExport);

    if (markersToExport.length === 0) {
      toast.error(
        exportAll
          ? "No markers available to export."
          : "No markers selected. Please select at least one marker."
      );
      return;
    }

    toast.info(
      `Preparing to export ${markersToExport.length} marker${
        markersToExport.length > 1 ? "s" : ""
      }...`
    );

    const exportPayload = {
      markers: markersToExport.map((m) => ({
        label: m.label,
        startMs: m.startMs,
        endMs: m.endMs,
      })),
    };

    console.log("Dispatching START_MARKER_EXPORT with payload:", exportPayload);

    // Dispatch event to trigger export with marker information
    dispatch("START_MARKER_EXPORT", {
      payload: exportPayload,
    });
  };

  // Monitor playback to handle sequential play
  useEffect(() => {
    if (!isSequentialPlaying || !sequentialPlayStateRef.current) return;

    const interval = setInterval(() => {
      const currentTime = getCurrentTime();
      const state = sequentialPlayStateRef.current;
      if (!state) return;

      const currentMarker = state.sortedMarkers[state.currentIndex];

      // Check if we've reached the end of current marker
      if (currentTime >= currentMarker.endMs && !state.isPausing) {
        state.isPausing = true;
        dispatch(PLAYER_PAUSE, { payload: {} });

        // Pause for 0.5s at the last frame
        setTimeout(() => {
          if (!sequentialPlayStateRef.current) return;

          const nextIndex = state.currentIndex + 1;

          // Check if there's a next marker
          if (nextIndex < state.sortedMarkers.length) {
            const nextMarker = state.sortedMarkers[nextIndex];
            sequentialPlayStateRef.current = {
              currentIndex: nextIndex,
              sortedMarkers: state.sortedMarkers,
              isPausing: false,
            };

            dispatch(PLAYER_SEEK, { payload: { time: nextMarker.startMs } });
            dispatch(PLAYER_PLAY, { payload: {} });
          } else {
            // End of all markers
            setIsSequentialPlaying(false);
            sequentialPlayStateRef.current = null;
            dispatch("SEQUENTIAL_PLAY_STATE_CHANGED", {
              payload: { isPlaying: false },
            });
          }
        }, 500);
      }
    }, 100); // Check every 100ms

    return () => clearInterval(interval);
  }, [isSequentialPlaying, markers]);

  // Dispatch selected markers state for header button
  useEffect(() => {
    dispatch("SELECTED_MARKERS_CHANGED", {
      payload: {
        hasSelectedMarkers: selectedMarkerIds.length > 0,
        count: selectedMarkerIds.length,
        totalMarkers: markers.length,
      },
    });
  }, [selectedMarkerIds, markers.length]);

  if (!timeline || !videoTrackInfo || markers.length === 0) {
    return null;
  }

  // Sort markers by startMs to calculate gaps
  const sortedMarkers = [...markers].sort((a, b) => a.startMs - b.startMs);

  // Create grayscale overlays for areas outside markers
  const grayscaleOverlays: Array<{ left: number; width: number }> = [];

  // Before first marker
  if (sortedMarkers.length > 0) {
    const firstMarkerLeft =
      timeMsToUnits(sortedMarkers[0].startMs, scale.zoom) - scroll.left;
    if (firstMarkerLeft > 0) {
      grayscaleOverlays.push({ left: 0, width: firstMarkerLeft });
    }
  }

  // Between markers
  for (let i = 0; i < sortedMarkers.length - 1; i++) {
    const currentEnd =
      timeMsToUnits(sortedMarkers[i].endMs, scale.zoom) - scroll.left;
    const nextStart =
      timeMsToUnits(sortedMarkers[i + 1].startMs, scale.zoom) - scroll.left;
    const gapWidth = nextStart - currentEnd;
    if (gapWidth > 0) {
      grayscaleOverlays.push({ left: currentEnd, width: gapWidth });
    }
  }

  // After last marker - extend to a large width to cover the rest
  if (sortedMarkers.length > 0) {
    const lastMarkerEnd =
      timeMsToUnits(sortedMarkers[sortedMarkers.length - 1].endMs, scale.zoom) -
      scroll.left;
    grayscaleOverlays.push({ left: lastMarkerEnd, width: 100000 }); // Very large width
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1,
        overflow: "hidden",
      }}
    >
      {/* Grayscale overlays for areas outside markers */}
      {grayscaleOverlays.map((overlay, index) => (
        <div
          key={`grayscale-${index}`}
          style={{
            position: "absolute",
            left: `${overlay.left}px`,
            top: `${videoTrackInfo.top - verticalScroll}px`,
            width: `${overlay.width}px`,
            height: `${videoTrackInfo.height}px`,
            backdropFilter: "grayscale(100%)",
            WebkitBackdropFilter: "grayscale(100%)",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Selection markers */}
      {markers.map((marker) => {
        const left = timeMsToUnits(marker.startMs, scale.zoom) - scroll.left;
        const width = timeMsToUnits(marker.endMs - marker.startMs, scale.zoom);
        const isSelected = selectedMarkerIds.includes(marker.id);

        return (
          <div
            key={marker.id}
            style={{
              position: "absolute",
              left: `${left}px`,
              top: `${videoTrackInfo.top - verticalScroll}px`,
              width: `${width}px`,
              height: `${videoTrackInfo.height}px`,
              border: `2px solid ${
                isSelected ? "#fbbf24" : "rgba(255, 255, 255, 0.9)"
              }`,
              borderRadius: "4px",
              pointerEvents: "auto",
              display: "flex",
              alignItems: "flex-start",
              padding: "8px",
              boxSizing: "border-box",
              cursor: "move",
              userSelect: "none",
              overflow: "hidden",
              backgroundColor: isSelected
                ? "rgba(251, 191, 36, 0.1)"
                : "transparent",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedMarkerIds((prev) =>
                  isSelected
                    ? prev.filter((id) => id !== marker.id)
                    : [...prev, marker.id]
                );
              }
            }}
            onMouseDown={(e) => handleMouseDown(e, marker.id, "move")}
          >
            {/* Left resize handle */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: "8px",
                height: "100%",
                cursor: "ew-resize",
                backgroundColor: "rgba(255, 255, 255, 0.5)",
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleMouseDown(e, marker.id, "resize-left");
              }}
            />

            {/* Right resize handle */}
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                width: "8px",
                height: "100%",
                cursor: "ew-resize",
                backgroundColor: "rgba(255, 255, 255, 0.5)",
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleMouseDown(e, marker.id, "resize-right");
              }}
            />

            <span
              style={{
                color: "rgba(255, 255, 255, 0.9)",
                fontSize: "14px",
                fontWeight: 600,
                fontFamily: "Inter, sans-serif",
                pointerEvents: "none",
                marginLeft: "6px",
              }}
            >
              {marker.label}
            </span>
          </div>
        );
      })}

      {/* Save dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Save Selection Group</DialogTitle>
          <DialogDescription className="hidden" />
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                value={saveDialogName}
                onChange={(e) => setSaveDialogName(e.target.value)}
                placeholder="Enter group name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && saveDialogName.trim()) {
                    handleSave();
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowSaveDialog(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!saveDialogName.trim()}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SelectionGroupOverlay;
