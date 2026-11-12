'use client';

// When a page is opened from a NetFirst scenario (?scenario=<slug>&focus=<row id>), pin the
// matching row, link it across grids and walk the viewer through it with driver.js.

import 'driver.js/dist/driver.css';
import { driver, type DriveStep } from 'driver.js';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { Row } from './data-grid';

const TITLES: Record<string, string> = { charge: 'Charge', 'true-up': 'True-Up', defer: 'Defer', settle: 'Settlement' };
const ORDER = ['charge', 'true-up', 'defer', 'settle'];

export function useScenarioFocus() {
  const params = useSearchParams();
  return { focus: params.get('focus'), scenario: params.get('scenario') };
}

const rowSel = (id: string) => `.ag-center-cols-container [row-id="${CSS.escape(id)}"]`;

export function ScenarioBar({ rows, ready }: { rows: Row[]; ready: boolean }) {
  const pathname = usePathname();
  const { focus, scenario } = useScenarioFocus();
  const started = useRef(false);
  const row = focus ? rows.find((r) => r.id === focus) : undefined;
  const title = scenario ? TITLES[scenario] ?? scenario : null;
  const onNetFirst = pathname.startsWith('/netfirst-invoices');
  const nextSlug = scenario ? ORDER[ORDER.indexOf(scenario) + 1] : undefined;
  const backHref = nextSlug ? `/treatments/${nextSlug}` : '/overview';
  const backLabel = nextSlug ? `Next: ${TITLES[nextSlug]}` : 'Back to overview';
  const paypalId = typeof row?.paypalInvoiceId === 'string' ? row.paypalInvoiceId : null;

  useEffect(() => {
    if (!ready || !focus || !row || started.current) return;
    started.current = true;
    const steps: DriveStep[] = onNetFirst
      ? [
          { element: '[data-guide="scenario-bar"]', popover: { title: `Your ${title} invoice, in Analytics`, description: 'You just ran this invoice through NetFirst. Here it is next to every other invoice in the sandbox.', side: 'bottom' } },
          { element: rowSel(focus), popover: { title: 'The exact transaction', description: 'Totals, FX line and rate swing come straight from the NetFirst ledger.', side: 'bottom' } },
          { element: `${rowSel(focus)} [col-id="treatment"]`, popover: { title: 'The treatment the agent chose', description: 'Filter this column to compare every invoice that got the same treatment.', side: 'bottom' } },
          ...(paypalId ? [{ element: '[data-guide="to-paypal"]', popover: { title: 'Now see it in PayPal', description: 'The same invoice, read back from the PayPal Invoicing API.', side: 'bottom' as const } }] : []),
        ]
      : [
          { element: rowSel(focus), popover: { title: 'The same invoice, in PayPal', description: 'Read live from GET /v2/invoicing/invoices. This is what your client receives.', side: 'bottom' } },
          { element: `${rowSel(focus)} [col-id="status"]`, popover: { title: 'Live PayPal status', description: 'It changes as the client views and pays it on PayPal.', side: 'bottom' } },
          { element: '[data-guide="back"]', popover: { title: nextSlug ? 'Next scenario' : 'All four done', description: nextSlug ? `Back to NetFirst to run ${TITLES[nextSlug]}.` : 'Back to the NetFirst overview.', side: 'bottom' } },
        ];
    const d = driver({
      steps,
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      popoverClass: 'nf-tour',
      overlayColor: '#0b1b33',
      overlayOpacity: 0.4,
      stagePadding: 4,
      stageRadius: 8,
    });
    const t = window.setTimeout(() => d.drive(), 500);
    return () => window.clearTimeout(t);
  }, [ready, focus, row, onNetFirst, paypalId, title, nextSlug]);

  if (!scenario) return null;

  return (
    <div data-guide="scenario-bar" className="flex flex-wrap items-center gap-3 rounded-lg border border-pp-border bg-pp-surface px-4 py-3">
      <span className="rounded-full bg-pp-highlight px-2.5 py-0.5 text-xs font-bold text-pp-navy">Scenario: {title}</span>
      <span className="min-w-0 flex-1 text-sm text-pp-muted">
        {row ? (onNetFirst ? `Following invoice ${String(row.invoiceNumber ?? '')}` : `Following PayPal invoice ${String(row.number ?? row.id)}`) : 'This invoice is not in the grid yet. Refresh in a moment.'}
      </span>
      {onNetFirst && paypalId && (
        <a data-guide="to-paypal" href={`/analytics/invoices?focus=${encodeURIComponent(paypalId)}&scenario=${scenario}`} className="rounded-full bg-pp-blue px-4 py-1.5 text-sm font-semibold text-white hover:bg-pp-blue-dark">
          See it in PayPal
        </a>
      )}
      <a data-guide="back" href={backHref} className="rounded-full border border-pp-border px-4 py-1.5 text-sm font-semibold text-pp-navy hover:bg-pp-highlight">
        {backLabel}
      </a>
    </div>
  );
}
