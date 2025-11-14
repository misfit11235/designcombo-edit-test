import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// This will be reused within the same warm container
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET - Fetch all selections or a single selection by id
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  try {
    if (id) {
      const { data, error } = await supabase
        .from("selections")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    } else {
      const { data, error } = await supabase
        .from("selections")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return NextResponse.json(data);
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Create a new selection
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, timeframes } = body;

    const { data, error } = await supabase
      .from("selections")
      .insert([{ name, timeframes }])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT - Update an existing selection
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, timeframes } = body;

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (timeframes !== undefined) updateData.timeframes = timeframes;

    const { data, error } = await supabase
      .from("selections")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Delete a selection
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  try {
    const { error } = await supabase.from("selections").delete().eq("id", id);

    if (error) throw error;
    return NextResponse.json({ message: "Selection deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
