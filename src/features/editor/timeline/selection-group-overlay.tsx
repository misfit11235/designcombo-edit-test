import { useEffect, useState, useRef } from "react";
import { filter, subject } from "@designcombo/events";
import useStore from "../store/use-store";
import { timeMsToUnits, unitsToTimeMs } from "@designcombo/timeline";

interface SelectionMarker {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  groupId: string;
}

interface DragState {
  markerId: string;
  type: "move" | "resize-left" | "resize-right";
  startX: number;
  startLeft: number;
  startWidth: number;
}

const SelectionGroupOverlay = () => {
  const { timeline, scale, scroll } = useStore();
  const [markers, setMarkers] = useState<SelectionMarker[]>([]);
  const [videoTrackInfo, setVideoTrackInfo] = useState<{ top: number; height: number } | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  // Get video track position
  useEffect(() => {
    if (!timeline) return;

    const updateVideoTrack = () => {
      const allObjects = timeline.getObjects();
      const videoItems = allObjects.filter((obj: any) => 
        obj.type === "Video" || obj.itemType === "video"
      );
      
      if (videoItems.length === 0) return false;

      const topVideoItem = videoItems.reduce((topmost: any, current: any) => {
        return (current.top < topmost.top) ? current : topmost;
      }, videoItems[0]);

      setVideoTrackInfo({
        top: topVideoItem.top,
        height: topVideoItem.height || 100,
      });
      
      return true;
    };

    // Try immediately
    if (!updateVideoTrack()) {
      // If no video items found, retry a few times
      let attempts = 0;
      const interval = setInterval(() => {
        if (updateVideoTrack() || attempts++ > 10) {
          clearInterval(interval);
        }
      }, 100);
      
      return () => clearInterval(interval);
    }
  }, [timeline, markers.length]);

  // Listen for load selection group events
  useEffect(() => {
    const subscription = subject
      .pipe(filter(({ key }) => key === "LOAD_SELECTION_GROUP"))
      .subscribe((event: any) => {
        const groupData = event.value?.payload;
        if (!groupData) return;

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

        // Convert to markers
        const newMarkers: SelectionMarker[] = [];
        
        if (typeof timeframes === "object" && !Array.isArray(timeframes)) {
          Object.entries(timeframes).forEach(([label, tf]: [string, any]) => {
            const start = Array.isArray(tf) ? tf[0] : (tf.start || tf.from || 0);
            const end = Array.isArray(tf) ? tf[1] : (tf.end || tf.to || 0);
            
            newMarkers.push({
              id: `${groupData.id}-${label}`,
              label,
              startMs: start * 1000,
              endMs: end * 1000,
              groupId: groupData.id,
            });
          });
        }

        setMarkers(newMarkers);
      });

    return () => subscription.unsubscribe();
  }, []);

  // Handle dragging and resizing
  const handleMouseDown = (e: React.MouseEvent, markerId: string, type: "move" | "resize-left" | "resize-right") => {
    e.preventDefault();
    e.stopPropagation();
    
    const marker = markers.find(m => m.id === markerId);
    if (!marker) return;

    const left = timeMsToUnits(marker.startMs, scale.zoom);
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

    const { markerId, type, startX, startLeft, startWidth } = dragStateRef.current;
    const deltaX = e.clientX - startX;

    setMarkers(prev => prev.map(marker => {
      if (marker.id !== markerId) return marker;

      if (type === "move") {
        const newLeft = startLeft + deltaX;
        const newStartMs = unitsToTimeMs(newLeft, scale.zoom);
        const duration = marker.endMs - marker.startMs;
        return {
          ...marker,
          startMs: Math.max(0, newStartMs),
          endMs: Math.max(0, newStartMs) + duration,
        };
      } else if (type === "resize-left") {
        const newLeft = startLeft + deltaX;
        const newStartMs = unitsToTimeMs(newLeft, scale.zoom);
        return {
          ...marker,
          startMs: Math.max(0, Math.min(newStartMs, marker.endMs - 100)),
        };
      } else if (type === "resize-right") {
        const newWidth = startWidth + deltaX;
        const newEndMs = unitsToTimeMs(startLeft + newWidth, scale.zoom);
        return {
          ...marker,
          endMs: Math.max(marker.startMs + 100, newEndMs),
        };
      }

      return marker;
    }));
  };

  const handleMouseUp = () => {
    if (dragStateRef.current) {
      dragStateRef.current = null;
    }
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  if (!timeline || !videoTrackInfo || markers.length === 0) {
    return null;
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
        zIndex: 10,
        overflow: "visible",
      }}
    >
      {markers.map((marker) => {
        const left = timeMsToUnits(marker.startMs, scale.zoom) - scroll.left;
        const width = timeMsToUnits(marker.endMs - marker.startMs, scale.zoom);

        return (
          <div
            key={marker.id}
            style={{
              position: "absolute",
              left: `${left}px`,
              top: `${videoTrackInfo.top}px`,
              width: `${width}px`,
              height: `${videoTrackInfo.height}px`,
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              border: "2px solid rgba(255, 255, 255, 0.9)",
              borderRadius: "4px",
              pointerEvents: "auto",
              display: "flex",
              alignItems: "flex-start",
              padding: "8px",
              boxSizing: "border-box",
              cursor: "move",
              userSelect: "none",
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
              }}
            >
              {marker.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default SelectionGroupOverlay;
