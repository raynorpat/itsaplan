import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';

// The new access key, shown this once: copy it into the CI secret now.
export default function AccessKeyCreatedDialog({
  accessKey,
  onClose,
}: {
  accessKey: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(accessKey);
    setCopied(true);
  };

  return (
    <Modal
      title="Access key created"
      description="Copy it now and store it as a CI secret. It is not shown again."
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <code className="min-w-0 flex-1 font-mono text-xs break-all">{accessKey}</code>
          <Button variant="ghost" size="icon" aria-label="Copy key" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
