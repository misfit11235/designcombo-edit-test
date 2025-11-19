import { Control, Resizable, ResizableProps } from "@designcombo/timeline";
import { IDisplay } from "@designcombo/types";
import { createResizeControls } from "../controls";
import { SECONDARY_FONT } from "../../constants/constants";

interface SelectionGroupProps extends ResizableProps {
  tScale: number;
  display: IDisplay;
  label: string;
  groupId: string;
}

class SelectionGroup extends Resizable {
  static type = "SelectionGroup";
  public label: string;
  public groupId: string;

  static createControls(): { controls: Record<string, Control> } {
    return { controls: createResizeControls() };
  }

  constructor(props: SelectionGroupProps) {
    super(props);
    // Semi-transparent white background
    this.fill = "rgba(255, 255, 255, 0.2)";
    this.tScale = props.tScale;
    this.display = props.display;
    this.label = props.label;
    this.groupId = props.groupId;

    // White border
    this.borderColor = "rgba(255, 255, 255, 0.9)";
    this.stroke = "rgba(255, 255, 255, 0.9)";
    this.strokeWidth = 2;

    // Make it resizable and movable
    this.selectable = true;
    this.evented = true;
    this.hasControls = true;
    this.lockMovementY = true; // Only lock vertical movement
    this.lockScalingY = true; // Only lock vertical resizing
    this.lockRotation = true; // Lock rotation

    // Allow horizontal movement and resizing
    this.lockMovementX = false;
    this.lockScalingX = false;

    // Set rounded corners
    this.rx = 4;
    this.ry = 4;

    // Mark this as an overlay to identify it
    (this as any).isOverlay = true;
    (this as any).isSelectionGroup = true;
    (this as any).excludeFromExport = true; // Critical: Tells state manager to ignore this

    // Critical: Set a flag that prevents state manager from processing this
    // The id format prevents state manager from finding this in trackItemsMap
    this.id = `selection-group-${props.groupId}-${Date.now()}`;
  }

  public _render(ctx: CanvasRenderingContext2D) {
    super._render(ctx);
    this.drawLabel(ctx);
    this.updateBorder(ctx);
  }

  public drawLabel(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(-this.width / 2, -this.height / 2);

    // Draw label text
    ctx.font = `600 14px ${SECONDARY_FONT}`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // Add padding from left edge
    const padding = 8;
    ctx.fillText(this.label, padding, padding);

    ctx.restore();
  }

  public updateBorder(ctx: CanvasRenderingContext2D) {
    const borderColor = this.isSelected
      ? "rgba(255, 255, 255, 1.0)"
      : "rgba(255, 255, 255, 0.8)";
    const borderWidth = 2;
    const radius = 4;

    ctx.save();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth;

    // Draw rounded rectangle border
    ctx.beginPath();
    ctx.roundRect(
      -this.width / 2,
      -this.height / 2,
      this.width,
      this.height,
      radius
    );
    ctx.stroke();

    ctx.restore();
  }
}

export default SelectionGroup;
