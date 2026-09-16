// Account snapshots are now written atomically by ai-monitor on every successful
// cycle. Kept as a disabled legacy export so no second writer creates divergent totals.
export default async()=>new Response(null,{status:204});
