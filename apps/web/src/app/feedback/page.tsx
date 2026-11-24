import { redirect } from 'next/navigation';
import { feedbackPeoplePath } from '@/utils/paths';

// The Feedback area opens on its People page.
export default function Page() {
  redirect(feedbackPeoplePath());
}
