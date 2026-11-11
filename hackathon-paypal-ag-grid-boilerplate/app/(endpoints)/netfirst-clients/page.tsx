import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getNetFirstData } from '@/lib/netfirst-data';
import { EndpointPage } from '../endpoint-page';

export const metadata: Metadata = { title: 'FX Clients — NetFirst' };

export default async function NetFirstClientsPage() {
  await connection();
  const { nfClients } = await getNetFirstData();

  return (
    <EndpointPage
      title="FX Clients"
      calls={['GET /api/clients']}
      source="getNetFirstData().nfClients"
      note="Client FX registry. FX Balance (INR) is the running total of FX lines charged minus credits applied. Positive = client owes FX fees; negative = client is owed a credit. Next Action signals when a settlement proposal should be raised."
      rows={nfClients}
      columns={[
        { field: 'name', headerName: 'Client' },
        { field: 'email', headerName: 'Email' },
        { field: 'country', headerName: 'Country' },
        { field: 'currency', headerName: 'Invoice CCY' },
        { field: 'invoicedAmount', headerName: 'Total Invoiced', type: 'money' },
        { field: 'fxCharged', headerName: 'FX Charged', type: 'money' },
        { field: 'fxBalance', headerName: 'FX Balance', type: 'money' },
        { field: 'fxCap', headerName: 'FX Cap', type: 'money' },
        { field: 'nextAction', headerName: 'Next Action' },
        { field: 'treatmentCharge', headerName: 'CHARGE' },
        { field: 'treatmentTrueUp', headerName: 'TRUE_UP' },
        { field: 'treatmentDefer', headerName: 'DEFER' },
        { field: 'totalTreatments', headerName: 'Total' },
      ]}
    />
  );
}
