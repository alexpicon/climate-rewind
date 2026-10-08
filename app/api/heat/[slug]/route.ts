import { loadHeatGrid } from "@/lib/index-store";

/** GET /api/heat/nashville : the regional heat grid, when one exists in data/heat/. */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  const grid = await loadHeatGrid(slug);

  if (!grid) return Response.json({ error: "No regional heat grid for that place." }, { status: 404 });
  return Response.json(grid, { headers: { "Cache-Control": "public, max-age=86400" } });
}
