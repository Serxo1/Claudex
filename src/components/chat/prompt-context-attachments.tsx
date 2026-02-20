import type { AttachmentData } from "@/components/ai-elements/attachments";
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
import type { ContextFileRef } from "@/lib/chat-types";

export type PromptContextAttachmentsProps = {
  items: AttachmentData[];
  contextFiles: ContextFileRef[];
  onRemove: (absolutePath: string) => void;
};

export function PromptContextAttachments({
  items,
  contextFiles,
  onRemove
}: PromptContextAttachmentsProps) {
  if (items.length === 0) return null;
  return (
    <Attachments className="mt-2 w-full" variant="inline">
      {items.map((item) => (
        <AttachmentHoverCard key={item.id}>
          <AttachmentHoverCardTrigger asChild>
            <Attachment
              data={item}
              onRemove={() => onRemove(item.id)}
              title={
                contextFiles.find((file) => file.absolutePath === item.id)?.relativePath || item.id
              }
            >
              <AttachmentPreview />
              <AttachmentInfo />
              <AttachmentRemove />
            </Attachment>
          </AttachmentHoverCardTrigger>
          <AttachmentHoverCardContent>
            <Attachment data={item}>
              <AttachmentPreview className="size-32" />
            </Attachment>
          </AttachmentHoverCardContent>
        </AttachmentHoverCard>
      ))}
    </Attachments>
  );
}
