import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getNetFirstData } from '@/lib/netfirst-data';
import { EndpointPage } from '../endpoint-page';

export const metadata: Metadata = { title: 'Settlement Proposals — NetFirst' };

export default async function NetFirstProposalsPage() {
  await connection();
  const { nfProposals } = await getNetFirstData();

  return (
    <EndpointPage
      title="Settlement Proposals"
      calls={['GET /api/proposals']}
      source="getNetFirstData().nfProposals"
      note="Open FX settlement proposals. When a loyal client's accumulated FX credit exceeds the settlement threshold, a proposal is raised and a PayPal invoice can be sent to square the balance."
      rows={nfProposals}
      columns={[
        { field: 'clientName', headerName: 'Client' },
        { field: 'amount', headerName: 'Settlement Amount', type: 'money' },
        { field: 'currency', headerName: 'Currency' },
        { field: 'status', headerName: 'Status' },
        { field: 'id', headerName: 'Proposal ID' },
      ]}
    />
  );
}
