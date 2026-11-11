import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getNetFirstData } from '@/lib/netfirst-data';
import { EndpointPage } from '../endpoint-page';

export const metadata: Metadata = { title: 'FX Invoices — NetFirst' };

export default async function NetFirstInvoicesPage() {
  await connection();
  const { nfInvoices } = await getNetFirstData();

  return (
    <EndpointPage
      title="FX Invoices"
      calls={['GET /api/invoices']}
      source="getNetFirstData().nfInvoices"
      note="AI-generated PayPal invoices with FX lines. Treatment: CHARGE (new client, full FX), TRUE_UP (repeat, FX settled against balance), DEFER (loyal, FX deferred to balance). Amounts in the invoice output currency."
      rows={nfInvoices}
      columns={[
        { field: 'invoiceNumber', headerName: 'Invoice #' },
        { field: 'status', headerName: 'Status' },
        { field: 'treatment', headerName: 'Treatment' },
        { field: 'description', headerName: 'Description' },
        { field: 'sourceAmount', headerName: 'Source Amount', type: 'money' },
        { field: 'sourceCurrency', headerName: 'Source CCY' },
        { field: 'total', headerName: 'Total', type: 'money' },
        { field: 'fxLine', headerName: 'FX Line', type: 'money' },
        { field: 'trueUp', headerName: 'True-Up Credit', type: 'money' },
        { field: 'currency', headerName: 'Output CCY' },
        { field: 'createdAt', headerName: 'Created', cellDataType: 'dateString' },
        { field: 'demoRate', headerName: 'Demo Rate' },
        { field: 'id', headerName: 'ID' },
      ]}
    />
  );
}
