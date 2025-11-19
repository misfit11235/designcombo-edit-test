import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { dispatch, subject, filter } from "@designcombo/events";
import { HISTORY_UNDO, HISTORY_REDO, DESIGN_RESIZE } from "@designcombo/state";
import { Icons } from "@/components/shared/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronDown,
  Download,
  ProportionsIcon,
  ShareIcon,
} from "lucide-react";
import { Label } from "@/components/ui/label";

import type StateManager from "@designcombo/state";
import { generateId } from "@designcombo/timeline";
import type { IDesign } from "@designcombo/types";
import { useDownloadState } from "./store/use-download-state";
import DownloadProgressModal from "./download-progress-modal";
import AutosizeInput from "@/components/ui/autosize-input";
import { debounce } from "lodash";
import {
  useIsLargeScreen,
  useIsMediumScreen,
  useIsSmallScreen,
} from "@/hooks/use-media-query";
import { toast } from "sonner";

import { LogoIcons } from "@/components/shared/logos";
import Link from "next/link";

export default function Navbar({
  user,
  stateManager,
  setProjectName,
  projectName,
}: {
  user: any | null;
  stateManager: StateManager;
  setProjectName: (name: string) => void;
  projectName: string;
}) {
  const [title, setTitle] = useState(projectName);
  const isLargeScreen = useIsLargeScreen();
  const isMediumScreen = useIsMediumScreen();
  const isSmallScreen = useIsSmallScreen();

  const handleUndo = () => {
    dispatch(HISTORY_UNDO);
  };

  const handleRedo = () => {
    dispatch(HISTORY_REDO);
  };

  const handleCreateProject = async () => {};

  // Create a debounced function for setting the project name
  const debouncedSetProjectName = useCallback(
    debounce((name: string) => {
      console.log("Debounced setProjectName:", name);
      setProjectName(name);
    }, 2000), // 2 seconds delay
    []
  );

  // Update the debounced function whenever the title changes
  useEffect(() => {
    debouncedSetProjectName(title);
  }, [title, debouncedSetProjectName]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isLargeScreen ? "320px 1fr 320px" : "1fr 1fr 1fr",
      }}
      className="bg-muted pointer-events-none flex h-11 items-center border-b border-border/80 px-2"
    >
      <DownloadProgressModal />

      <div className="flex items-center gap-2">
        <div className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-md text-zinc-200">
          <LogoIcons.scenify />
        </div>

        <div className=" pointer-events-auto flex h-10 items-center px-1.5">
          <Button
            onClick={handleUndo}
            className="text-muted-foreground"
            variant="ghost"
            size="icon"
            data-undo-button
          >
            <Icons.undo width={20} />
          </Button>
          <Button
            onClick={handleRedo}
            className="text-muted-foreground"
            variant="ghost"
            size="icon"
          >
            <Icons.redo width={20} />
          </Button>
        </div>
      </div>

      <div className="flex h-11 items-center justify-center gap-2">
        {!isSmallScreen && (
          <div className=" pointer-events-auto flex h-10 items-center gap-2 rounded-md px-2.5 text-muted-foreground">
            <AutosizeInput
              name="title"
              value={title}
              onChange={handleTitleChange}
              width={200}
              inputClassName="border-none outline-none px-1 bg-background text-sm font-medium text-zinc-200"
            />
          </div>
        )}
      </div>

      <div className="flex h-11 items-center justify-end gap-2">
        <div className=" pointer-events-auto flex h-10 items-center gap-2 rounded-md px-2.5">
          <Link href="https://discord.gg/Jmxsd5f2jp" target="_blank">
            <Button className="h-7 rounded-lg" variant={"outline"}>
              <LogoIcons.discord className="w-6 h-6" />
              <span className="hidden md:block">Join Us</span>
            </Button>
          </Link>
          <Button
            className="flex h-7 gap-1 border border-border"
            variant="outline"
            size={isMediumScreen ? "sm" : "icon"}
          >
            <ShareIcon width={18} />{" "}
            <span className="hidden md:block">Share</span>
          </Button>

          <DownloadPopover stateManager={stateManager} />
        </div>
      </div>
    </div>
  );
}

const DownloadPopover = ({ stateManager }: { stateManager: StateManager }) => {
  const isMediumScreen = useIsMediumScreen();
  const { actions, exportType } = useDownloadState();
  const [isExportTypeOpen, setIsExportTypeOpen] = useState(false);
  const [open, setOpen] = useState(false);

  const handleExport = () => {
    const data: IDesign = {
      id: generateId(),
      ...stateManager.toJSON(),
    };

    console.log({ data });

    actions.setState({ payload: data });
    actions.startExport();
  };

  // Listen for marker export trigger
  useEffect(() => {
    console.log("Navbar: Setting up START_MARKER_EXPORT listener");

    const subscription = subject
      .pipe(filter(({ key }) => key === "START_MARKER_EXPORT"))
      .subscribe(async (event: any) => {
        console.log("Navbar: Received START_MARKER_EXPORT event", event);

        const markers = event.value?.payload?.markers;

        if (!markers) {
          console.log("Navbar: No markers in payload", event);
          return;
        }

        console.log("Navbar: Processing markers", markers);

        for (const marker of markers) {
          try {
            // Get the current editor state
            const editorState = stateManager.toJSON();

            console.log("Original editor state:", editorState);
            console.log("Marker:", marker);

            // Calculate marker duration
            const markerDurationMs = marker.endMs - marker.startMs;

            // Adjust track items' times relative to marker start and filter items within range
            const adjustedTrackItemsMap: Record<string, any> = {};
            const filteredTrackItemIds: string[] = [];

            Object.entries(editorState.trackItemsMap).forEach(
              ([key, item]: [string, any]) => {
                const itemStart = item.display?.from || 0;
                const itemEnd = item.display?.to || 0;

                // Check if item overlaps with marker range
                if (itemEnd > marker.startMs && itemStart < marker.endMs) {
                  // Calculate new times relative to marker start
                  const newFrom = Math.max(0, itemStart - marker.startMs);
                  const newTo = Math.min(
                    markerDurationMs,
                    itemEnd - marker.startMs
                  );

                  adjustedTrackItemsMap[key] = {
                    ...item,
                    display: {
                      ...item.display,
                      from: newFrom,
                      to: newTo,
                    },
                  };

                  filteredTrackItemIds.push(key);
                }
              }
            );

            // Update tracks to only include items within the marker range
            const adjustedTracks = editorState.tracks.map((track: any) => ({
              ...track,
              items: track.items.filter((itemId: string) =>
                filteredTrackItemIds.includes(itemId)
              ),
            }));

            // Create a modified state for this marker
            const markerState = {
              ...editorState,
              trackItemsMap: adjustedTrackItemsMap,
              trackItemIds: filteredTrackItemIds,
              tracks: adjustedTracks,
            };

            console.log("Adjusted marker state:", markerState);

            // Get FPS from editor state
            const fps = editorState.fps || 30;

            // Wrap the marker state in a design object with proper structure
            const designData = {
              id: generateId(),
              ...markerState,
            };

            const requestBody = {
              design: designData,
              options: {
                fps: fps,
                size: markerState.size,
                format: "mp4",
              },
            };

            console.log("Sending render request:", requestBody);

            // Call the render API
            const response = await fetch("/api/render", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
              const errorData = await response.json();
              console.error("Render API error response:", errorData);
              toast.error(
                errorData.message || `Failed to export marker ${marker.label}`
              );
              continue;
            }

            const data = await response.json();
            console.log(`Marker ${marker.label} export started:`, data);

            // TODO: Poll for completion and download
            // For now, show in download modal
            toast.success(`Export started for ${marker.label}`);
          } catch (error) {
            console.error(`Export error for marker ${marker.label}:`, error);
            toast.error(`Failed to export ${marker.label}`);
          }
        }
      });

    return () => subscription.unsubscribe();
  }, [stateManager]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          className="flex h-7 gap-1 border border-border"
          size={isMediumScreen ? "sm" : "icon"}
        >
          <Download width={18} />{" "}
          <span className="hidden md:block">Export</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="bg-sidebar z-[250] flex w-60 flex-col gap-4"
      >
        <Label>Export settings</Label>

        <Popover open={isExportTypeOpen} onOpenChange={setIsExportTypeOpen}>
          <PopoverTrigger asChild>
            <Button className="w-full justify-between" variant="outline">
              <div>{exportType.toUpperCase()}</div>
              <ChevronDown width={16} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="bg-background z-[251] w-[--radix-popover-trigger-width] px-2 py-2">
            <div
              className="flex h-7 items-center rounded-sm px-3 text-sm hover:cursor-pointer hover:bg-zinc-800"
              onClick={() => {
                actions.setExportType("mp4");
                setIsExportTypeOpen(false);
              }}
            >
              MP4
            </div>
            <div
              className="flex h-7 items-center rounded-sm px-3 text-sm hover:cursor-pointer hover:bg-zinc-800"
              onClick={() => {
                actions.setExportType("json");
                setIsExportTypeOpen(false);
              }}
            >
              JSON
            </div>
          </PopoverContent>
        </Popover>

        <div>
          <Button onClick={handleExport} className="w-full">
            Export
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

interface ResizeOptionProps {
  label: string;
  icon: string;
  value: ResizeValue;
  description: string;
}

interface ResizeValue {
  width: number;
  height: number;
  name: string;
}

const RESIZE_OPTIONS: ResizeOptionProps[] = [
  {
    label: "16:9",
    icon: "landscape",
    description: "YouTube ads",
    value: {
      width: 1920,
      height: 1080,
      name: "16:9",
    },
  },
  {
    label: "9:16",
    icon: "portrait",
    description: "TikTok, YouTube Shorts",
    value: {
      width: 1080,
      height: 1920,
      name: "9:16",
    },
  },
  {
    label: "1:1",
    icon: "square",
    description: "Instagram, Facebook posts",
    value: {
      width: 1080,
      height: 1080,
      name: "1:1",
    },
  },
];

const ResizeVideo = () => {
  const handleResize = (options: ResizeValue) => {
    dispatch(DESIGN_RESIZE, {
      payload: {
        ...options,
      },
    });
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="z-10 h-7 gap-2" variant="outline" size={"sm"}>
          <ProportionsIcon className="h-4 w-4" />
          <div>Resize</div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[250] w-60 px-2.5 py-3">
        <div className="text-sm">
          {RESIZE_OPTIONS.map((option, index) => (
            <ResizeOption
              key={index}
              label={option.label}
              icon={option.icon}
              value={option.value}
              handleResize={handleResize}
              description={option.description}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const ResizeOption = ({
  label,
  icon,
  value,
  description,
  handleResize,
}: ResizeOptionProps & { handleResize: (payload: ResizeValue) => void }) => {
  const Icon = Icons[icon as "text"];
  return (
    <div
      onClick={() => handleResize(value)}
      className="flex cursor-pointer items-center rounded-md p-2 hover:bg-zinc-50/10"
    >
      <div className="w-8 text-muted-foreground">
        <Icon size={20} />
      </div>
      <div>
        <div>{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
};
