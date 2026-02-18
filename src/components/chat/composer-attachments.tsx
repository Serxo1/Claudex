import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments
} from "@/components/ai-elements/attachments";
import { usePromptInputAttachments } from "@/components/ai-elements/prompt-input";

export function ComposerPromptAttachments() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <Attachments className="mt-2 w-full" variant="inline">
      {attachments.files.map((file) => (
        <AttachmentHoverCard key={file.id}>
          <AttachmentHoverCardTrigger asChild>
            <Attachment
              data={{ ...file, id: file.id }}
              onRemove={() => attachments.remove(file.id)}
            >
              <AttachmentPreview />
              <AttachmentInfo />
              <AttachmentRemove />
            </Attachment>
          </AttachmentHoverCardTrigger>
          <AttachmentHoverCardContent>
            <Attachment data={{ ...file, id: file.id }}>
              <AttachmentPreview className="size-32" />
            </Attachment>
          </AttachmentHoverCardContent>
        </AttachmentHoverCard>
      ))}
    </Attachments>
  );
}
