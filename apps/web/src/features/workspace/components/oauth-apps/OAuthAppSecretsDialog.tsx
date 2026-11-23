import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import type { OAuthAppSecrets } from '../../services/oauthApps.service';
import OAuthAppSecretValue from './OAuthAppSecretValue';

// The secrets an application was just given (on create or a rotation). They are kept
// in this dialog only and cannot be shown again.
export default function OAuthAppSecretsDialog({
  title,
  clientId,
  secrets,
  onClose,
}: {
  title: string;
  clientId?: string;
  secrets: OAuthAppSecrets;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Copy the secrets now. For security, they are shown only once and cannot be retrieved
          later.
        </p>
        {clientId && <OAuthAppSecretValue label="Client ID" value={clientId} />}
        {secrets.clientSecret && (
          <OAuthAppSecretValue label="Client secret" value={secrets.clientSecret} />
        )}
        {secrets.webhookSecret && (
          <OAuthAppSecretValue label="Webhook secret" value={secrets.webhookSecret} />
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
