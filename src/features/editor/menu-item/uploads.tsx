import { useCallback, useEffect, useState } from "react";
import { ADD_AUDIO, ADD_IMAGE, ADD_VIDEO } from "@designcombo/state";
import { dispatch, filter, subject } from "@designcombo/events";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import {
  Music,
  Image as ImageIcon,
  Video as VideoIcon,
  Loader2,
  UploadIcon,
} from "lucide-react";
import { generateId } from "@designcombo/timeline";
import { Button } from "@/components/ui/button";
import useUploadStore from "../store/use-upload-store";
import ModalUpload from "@/components/modal-upload";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SelectionGroup = {
  id: string;
  name?: string;
  timeframes?: unknown;
  created_at?: string;
  updated_at?: string;
};

type NormalizedTimeframe = {
  label: string;
  start?: number | string;
  end?: number | string;
};

const extractRange = (
  entry: unknown
): { start?: number | string; end?: number | string } => {
  if (entry === null || entry === undefined) return {};
  if (Array.isArray(entry)) {
    return {
      start: entry[0],
      end: entry[1],
    };
  }
  if (typeof entry === "object") {
    const value = entry as Record<string, any>;
    return {
      start:
        value.start ??
        value.from ??
        value.timeframe?.start ??
        value.timeframe?.from ??
        value[0],
      end:
        value.end ??
        value.to ??
        value.timeframe?.end ??
        value.timeframe?.to ??
        value[1],
    };
  }
  return {};
};

const parseTimeframes = (value: unknown): NormalizedTimeframe[] => {
  if (!value) return [];

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parseTimeframes(parsed);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry, idx) => {
      const { start, end } = extractRange(entry);
      return {
        label: `Range ${idx + 1}`,
        start,
        end,
      };
    });
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(
      ([label, entry], idx) => {
        const { start, end } = extractRange(entry);
        return {
          label: label || `Range ${idx + 1}`,
          start,
          end,
        };
      }
    );
  }

  return [];
};

const formatDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

export const Uploads = () => {
  const { setShowUploadModal, uploads, pendingUploads, activeUploads } =
    useUploadStore();
  const [selectionModalOpen, setSelectionModalOpen] = useState(false);
  const [selectionGroups, setSelectionGroups] = useState<SelectionGroup[]>([]);
  const [selectionGroupsLoading, setSelectionGroupsLoading] = useState(false);
  const [selectionGroupsError, setSelectionGroupsError] = useState<
    string | null
  >(null);
  const [hasSelectionGroupModifications, setHasSelectionGroupModifications] =
    useState(false);

  const fetchSelectionGroups = useCallback(async () => {
    setSelectionGroupsLoading(true);
    setSelectionGroupsError(null);
    try {
      const response = await fetch("/api/uploads/selection-groups");
      if (!response.ok) {
        throw new Error("Unable to fetch selection groups.");
      }
      const data = await response.json();
      const groups = Array.isArray(data) ? data : data ? [data] : [];
      setSelectionGroups(groups);
    } catch (error) {
      setSelectionGroupsError(
        error instanceof Error
          ? error.message
          : "Something went wrong while loading selection groups."
      );
    } finally {
      setSelectionGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectionModalOpen) {
      fetchSelectionGroups();
    }
  }, [selectionModalOpen, fetchSelectionGroups]);

  // Listen for selection group modifications state
  useEffect(() => {
    const subscription = subject
      .pipe(
        filter(({ key }) => key === "SELECTION_GROUP_MODIFICATIONS_CHANGED")
      )
      .subscribe((event: any) => {
        const hasModifications =
          event.value?.payload?.hasModifications ?? false;
        setHasSelectionGroupModifications(hasModifications);
      });

    return () => subscription.unsubscribe();
  }, []);

  // Group completed uploads by type
  const videos = uploads.filter(
    (upload) => upload.type?.startsWith("video/") || upload.type === "video"
  );
  const images = uploads.filter(
    (upload) => upload.type?.startsWith("image/") || upload.type === "image"
  );
  const audios = uploads.filter(
    (upload) => upload.type?.startsWith("audio/") || upload.type === "audio"
  );

  const handleAddVideo = (video: any) => {
    const srcVideo = video.metadata?.uploadedUrl || video.url;

    dispatch(ADD_VIDEO, {
      payload: {
        id: generateId(),
        details: {
          src: srcVideo,
        },
        metadata: {
          previewUrl:
            "https://cdn.designcombo.dev/caption_previews/static_preset1.webp",
        },
      },
      options: {
        resourceId: "main",
        scaleMode: "fit",
      },
    });
  };

  const handleAddImage = (image: any) => {
    const srcImage = image.metadata?.uploadedUrl || image.url;

    dispatch(ADD_IMAGE, {
      payload: {
        id: generateId(),
        type: "image",
        display: {
          from: 0,
          to: 5000,
        },
        details: {
          src: srcImage,
        },
        metadata: {},
      },
      options: {},
    });
  };

  const handleAddAudio = (audio: any) => {
    const srcAudio = audio.metadata?.uploadedUrl || audio.url;
    dispatch(ADD_AUDIO, {
      payload: {
        id: generateId(),
        type: "audio",
        details: {
          src: srcAudio,
        },
        metadata: {},
      },
      options: {},
    });
  };

  const UploadPrompt = ({
    onLoadSelectionGroups,
  }: {
    onLoadSelectionGroups: () => void;
  }) => (
    <div className="flex flex-col space-y-2 items-center justify-center px-4">
      <Button
        className="w-full cursor-pointer"
        onClick={() => setShowUploadModal(true)}
      >
        <UploadIcon className="w-4 h-4" />
        <span className="ml-2">Upload</span>
      </Button>
      <Button
        className="w-full cursor-pointer"
        variant="secondary"
        onClick={onLoadSelectionGroups}
      >
        <span className="ml-2">Load selection groups</span>
      </Button>
      <Button
        className="w-full cursor-pointer"
        variant={hasSelectionGroupModifications ? "default" : "outline"}
        disabled={!hasSelectionGroupModifications}
        onClick={() => {
          dispatch("SAVE_SELECTION_GROUP", { payload: {} });
        }}
      >
        <span className="ml-2">Save selection group</span>
      </Button>
      <Button
        className="w-full cursor-pointer"
        variant="outline"
        onClick={() => {
          console.log("Button clicked: EXPORT_SELECTED_MARKERS");
          dispatch("EXPORT_SELECTED_MARKERS", { payload: {} });
          console.log("Dispatched: EXPORT_SELECTED_MARKERS");
        }}
      >
        <VideoIcon size={16} />
        <span className="ml-2">Export selected markers</span>
      </Button>
      <Button
        className="w-full cursor-pointer"
        variant="outline"
        onClick={() => {
          console.log("Button clicked: EXPORT_ALL_MARKERS");
          dispatch("EXPORT_ALL_MARKERS", { payload: {} });
          console.log("Dispatched: EXPORT_ALL_MARKERS");
        }}
      >
        <VideoIcon size={16} />
        <span className="ml-2">Export all markers</span>
      </Button>
    </div>
  );

  const SelectionGroupsDialog = () => (
    <Dialog open={selectionModalOpen} onOpenChange={setSelectionModalOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Selection groups</DialogTitle>
          <DialogDescription>
            Browse the saved selection groups available for your project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {selectionGroupsLoading && (
            <div className="flex items-center justify-center py-6 gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading selection groups…
            </div>
          )}
          {!selectionGroupsLoading && selectionGroupsError && (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                {selectionGroupsError}
              </p>
              <Button size="sm" onClick={fetchSelectionGroups}>
                Try again
              </Button>
            </div>
          )}
          {!selectionGroupsLoading &&
            !selectionGroupsError &&
            selectionGroups.length === 0 && (
              <p className="text-sm text-muted-foreground text-center">
                No selection groups found.
              </p>
            )}
          {!selectionGroupsLoading &&
            !selectionGroupsError &&
            selectionGroups.length > 0 && (
              <ScrollArea className="max-h-80 pr-4">
                <div className="space-y-3">
                  {selectionGroups.map((group) => {
                    const parsedTimeframes = parseTimeframes(group.timeframes);
                    return (
                      <Card key={group.id} className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <p className="text-sm font-medium">
                              {group.name || "Untitled selection"}
                            </p>
                            {group.created_at && (
                              <p className="text-xs text-muted-foreground">
                                Created {formatDateTime(group.created_at)}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {parsedTimeframes.length}{" "}
                              {parsedTimeframes.length === 1
                                ? "timeframe"
                                : "timeframes"}
                            </span>
                            <Button
                              size="sm"
                              onClick={() => {
                                dispatch("LOAD_SELECTION_GROUP", {
                                  payload: group,
                                });
                                setSelectionModalOpen(false);
                              }}
                            >
                              Load
                            </Button>
                          </div>
                        </div>
                        {parsedTimeframes.length > 0 && (
                          <div className="rounded-md bg-muted p-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase">
                              Timeframes preview
                            </p>
                            <div className="mt-1 space-y-1 text-xs text-foreground">
                              {parsedTimeframes
                                .slice(0, 3)
                                .map((frame, idx) => {
                                  const start =
                                    frame.start !== undefined
                                      ? frame.start
                                      : "-";
                                  const end =
                                    frame.end !== undefined ? frame.end : "-";
                                  return (
                                    <div
                                      key={`${group.id}-${idx}`}
                                      className="flex items-center gap-2"
                                    >
                                      <span className="font-medium">
                                        {frame.label}:
                                      </span>
                                      <span>
                                        {start} → {end}
                                      </span>
                                    </div>
                                  );
                                })}
                              {parsedTimeframes.length > 3 && (
                                <p className="text-xs text-muted-foreground">
                                  +{parsedTimeframes.length - 3} more
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="text-text-primary flex h-12 flex-none items-center px-4 text-sm font-medium">
        Your uploads
      </div>
      <ModalUpload />
      <UploadPrompt onLoadSelectionGroups={() => setSelectionModalOpen(true)} />
      <SelectionGroupsDialog />

      {/* Uploads in Progress Section */}
      {(pendingUploads.length > 0 || activeUploads.length > 0) && (
        <div className="p-4">
          <div className="font-medium text-sm mb-2 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            Uploads in Progress
          </div>
          <div className="flex flex-col gap-2">
            {pendingUploads.map((upload) => (
              <div key={upload.id} className="flex items-center gap-2">
                <span className="truncate text-xs flex-1">
                  {upload.file?.name || upload.url || "Unknown"}
                </span>
                <span className="text-xs text-muted-foreground">Pending</span>
              </div>
            ))}
            {activeUploads.map((upload) => (
              <div key={upload.id} className="flex items-center gap-2">
                <span className="truncate text-xs flex-1">
                  {upload.file?.name || upload.url || "Unknown"}
                </span>
                <div className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  <span className="text-xs">{upload.progress ?? 0}%</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {upload.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-10 p-4">
        {/* Videos Section */}
        {videos.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <VideoIcon className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium text-sm">Videos</span>
            </div>
            <ScrollArea className="max-h-32">
              <div className="grid grid-cols-3 gap-2 max-w-full">
                {videos.map((video, idx) => (
                  <div
                    className="flex items-center gap-2 flex-col w-full"
                    key={video.id || idx}
                  >
                    <Card
                      className="w-16 h-16 flex items-center justify-center overflow-hidden relative cursor-pointer"
                      onClick={() => handleAddVideo(video)}
                    >
                      <VideoIcon className="w-8 h-8 text-muted-foreground" />
                    </Card>
                    <div className="text-xs text-muted-foreground truncate w-full text-center">
                      {video.file?.name || video.url || "Video"}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Images Section */}
        {images.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium text-sm">Images</span>
            </div>
            <ScrollArea className="max-h-32">
              <div className="grid grid-cols-3 gap-2 max-w-full">
                {images.map((image, idx) => (
                  <div
                    className="flex items-center gap-2 flex-col w-full"
                    key={image.id || idx}
                  >
                    <Card
                      className="w-16 h-16 flex items-center justify-center overflow-hidden relative cursor-pointer"
                      onClick={() => handleAddImage(image)}
                    >
                      <ImageIcon className="w-8 h-8 text-muted-foreground" />
                    </Card>
                    <div className="text-xs text-muted-foreground truncate w-full text-center">
                      {image.file?.name || image.url || "Image"}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Audios Section */}
        {audios.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Music className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium text-sm">Audios</span>
            </div>
            <ScrollArea className="max-h-32">
              <div className="grid grid-cols-3 gap-2 max-w-full">
                {audios.map((audio, idx) => (
                  <div
                    className="flex items-center gap-2 flex-col w-full"
                    key={audio.id || idx}
                  >
                    <Card
                      className="w-16 h-16 flex items-center justify-center overflow-hidden relative cursor-pointer"
                      onClick={() => handleAddAudio(audio)}
                    >
                      <Music className="w-8 h-8 text-muted-foreground" />
                    </Card>
                    <div className="text-xs text-muted-foreground truncate w-full text-center">
                      {audio.file?.name || audio.url || "Audio"}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
};
