import ChildDashboard from '@/components/ChildDashboard';

export default function ChildPage({ params }: { params: { id: string } }) {
  return <ChildDashboard childId={Number(params.id)} />;
}
