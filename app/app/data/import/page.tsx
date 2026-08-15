import type { Metadata } from 'next';
import Link from 'next/link';
import { IngestionWorkflow } from '@/components/app/ingestion-workflow';
import { MethodologyNote, SectionHeading } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Import data' };

export default function ImportPage() {
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
        description="Upload an export from FlexNet, RLM, DSLS, Sentinel, or any tabular file. EngiSignal identifies the source, proposes a mapping, and shows exactly what would be stored before anything is committed."
      />

      <IngestionWorkflow />

      <MethodologyNote>
        Nothing is applied silently. A mapping that quietly guesses wrong produces confidently wrong
        purchasing recommendations, so every suggestion is presented for confirmation and every rejected
        row is reported with its reason and an example value.
      </MethodologyNote>
    </div>
  );
}
