import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

/** Unmissable until an admin marks the ACTIVE rate card as reviewed. */
export function SampleRatesBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    supabase
      .from('rate_cards')
      .select('reviewed_at, is_sample')
      .eq('status', 'active')
      .maybeSingle()
      .then(({ data }) => setShow(!data || data.is_sample || !data.reviewed_at));
  }, []);
  if (!show) return null;
  return (
    <div role="alert" className="mb-5 border-2 border-danger bg-paper p-4">
      <p className="text-[1rem] font-[800] text-danger">⚠ Sample rates: replace with your rates before sending quotes</p>
      <p className="mt-1 text-[0.875rem]">
        The active rate card has not been reviewed. Every price here is a placeholder until an admin enters your real rates
        and chooses <strong>Mark reviewed</strong> (Estimates → Rate cards).
      </p>
    </div>
  );
}
