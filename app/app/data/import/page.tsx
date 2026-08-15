import type { Metadata } from 'next';
import Link from 'next/link';
import { ImportWorkflow } from '@/components/app/import-workflow';
import { MethodologyNote, SectionHeading } from '@/components/ui/primitives';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Import data' };

export default async function ImportPage() {
  const { dataset } = await loadWorkspace();

  return (
    <div>
      <nav className="mb-2 flex items-center gap-1.5 text-[12px] text-fg-subtle">
        <Link href="/app/data" className="hover:text-fg">
          Data
        </Link>
        <span>/</span>
        <span>Import</span>
      </nav>

      <SectionHeading
        eyebrow="Import"
        title="Bring your data in as it already is"
        description="Upload a CSV or XLSX export. EngiSignal reads the column headers, proposes a mapping, and shows exactly what would be accepted before anything is committed."
      />

      <ImportWorkflow
        savedMappings={dataset.importMappings.map((mapping) => ({
          id: mapping.id,
          name: mapping.name,
          kind: mapping.kind,
          fields: mapping.fields,
        }))}
      />

      <MethodologyNote>
        Nothing is applied silently. A mapping that quietly guesses wrong produces confidently wrong
        purchasing recommendations, so every suggestion is presented for confirmation and every rejected
        row is reported with its reason and an example value.
      </MethodologyNote>
    </div>
  );
}
