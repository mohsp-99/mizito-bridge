// List the projects & boards in a workspace (active by default).
//
//   node apps/crawler/projects.mjs                 # active workspace
//   node apps/crawler/projects.mjs "Workspace Name"
//
// Handy for finding the exact project/board names to pass when creating tasks.
import { buildContext } from '@mohsp-99/mizito';
import { listProjects } from '@mohsp-99/mizito';

const workspace = process.argv[2] || process.env.WORKSPACE || undefined;

try {
  const ctx = await buildContext();
  const { workspace: ws, count, projects } = await listProjects(ctx, { workspace });
  console.log(`\n${ws} — ${count} project(s)\n`);
  for (const p of projects) {
    const tags = [p.is_advanced ? 'advanced' : 'simple', p.archived ? 'archived' : null]
      .filter(Boolean)
      .join(', ');
    console.log(`• ${p.title}  [${tags}]`);
    console.log(`    id: ${p.id}${p.dialog ? `   dialog: ${p.dialog}` : ''}`);
    if (p.boards.length) {
      console.log(`    boards: ${p.boards.map((b) => b.title).filter(Boolean).join(' | ')}`);
    }
  }
  console.log('');
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}
