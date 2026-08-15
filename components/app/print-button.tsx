'use client';

import { Button } from '@/components/ui/primitives';
import { IconPrint } from './icons';

export function PrintButton({ label = 'Print / Save as PDF' }: { label?: string }) {
  return (
    <Button variant="primary" onClick={() => window.print()} className="no-print">
      <IconPrint size={15} />
      {label}
    </Button>
  );
}
