import { getOpsData } from './lib/ops-data';
import { OpsStudio } from './ops-studio';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const initialData = await getOpsData();
  return <OpsStudio initialData={initialData} />;
}
