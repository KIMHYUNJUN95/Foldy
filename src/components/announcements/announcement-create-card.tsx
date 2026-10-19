"use client";

import { startTransition, useRef, useState, useTransition } from "react";
import { Megaphone } from "lucide-react";
import {
  createAnnouncement,
  cleanupAnnouncementImagePaths,
} from "@/app/admin/announcements/actions";
import { organizationRoles } from "@/config/roles";
import type { OrganizationRole } from "@/config/roles";
import {
  AnnouncementImageUploader,
  type AnnouncementImageUploaderHandle,
} from "@/components/announcements/announcement-image-uploader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const BUCKET = "announcement-images";

type OrgOption = { id: string; name: string };

type Copy = {
  allowComments: string;
  content: string;
  create: string;
  createTitle: string;
  description: string;
  imageAdd: string;
  imageAttachments: string;
  imageLimit: string;
  imageRemove: string;
  important: string;
  organization: string;
  pinned: string;
  roleTargets: string;
  showPopup: string;
  titleField: string;
  errors: Record<string, string>;
  statuses: Record<string, string>;
  targetScopes: Record<string, string>;
  targetRoles: Record<OrganizationRole, string>;
};

type Props = {
  copy: Copy;
  organizations: OrgOption[];
};

function getFileExtension(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && /^[a-z0-9]+$/.test(ext)) return ext;
  return file.type.split("/")[1] ?? "jpg";
}

export function AnnouncementCreateCard({ copy, organizations }: Props) {
  const uploaderRef = useRef<AnnouncementImageUploaderHandle>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [isPending, startServerTransition] = useTransition();

  const isDisabled = organizations.length === 0 || isUploading || isPending;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsUploading(true);
    setClientError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const organizationId = String(formData.get("organizationId") ?? "");

    const items = uploaderRef.current?.getItems() ?? [];
    const announcementId = crypto.randomUUID();
    const imageUrls: string[] = [];
    const uploadedPaths: string[] = [];

    try {
      const supabase = getSupabaseBrowserClient();

      for (const item of items) {
        const ext = getFileExtension(item.file);
        const path = `${organizationId}/${announcementId}/${crypto.randomUUID()}.${ext}`;

        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, item.file, { contentType: item.file.type, upsert: false });

        if (error) {
          if (uploadedPaths.length > 0) {
            startTransition(async () => {
              await cleanupAnnouncementImagePaths(announcementId, uploadedPaths);
            });
          }
          setClientError(copy.errors.save_failed);
          setIsUploading(false);
          return;
        }

        uploadedPaths.push(path);
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        imageUrls.push(data.publicUrl);
      }
    } catch {
      if (uploadedPaths.length > 0) {
        startTransition(async () => {
          await cleanupAnnouncementImagePaths(announcementId, uploadedPaths);
        });
      }
      setClientError(copy.errors.save_failed);
      setIsUploading(false);
      return;
    }

    formData.set("announcementId", announcementId);
    for (const url of imageUrls) {
      formData.append("imageUrls", url);
    }

    setIsUploading(false);
    startServerTransition(async () => {
      await createAnnouncement(formData);
    });
  }

  return (
    <Card className="rounded-lg p-5 shadow-sm">
      <div className="flex items-start gap-3 border-b-[0.5px] border-[var(--separator)] pb-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Megaphone aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-black leading-tight">{copy.createTitle}</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-muted-foreground">
            {copy.description}
          </p>
        </div>
      </div>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <select
          className="h-11 w-full rounded-lg border border-border bg-surface/80 px-3 text-sm font-semibold text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
          defaultValue={organizations[0]?.id ?? ""}
          name="organizationId"
          required
        >
          <option value="">{copy.organization}</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>

        <Input name="title" placeholder={copy.titleField} required />

        <textarea
          className="min-h-36 w-full resize-y rounded-lg border border-border bg-surface/80 px-3 py-3 text-sm font-semibold text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
          name="content"
          placeholder={copy.content}
          required
        />

        <AnnouncementImageUploader
          addImagesLabel={copy.imageAdd}
          errorCountExceeded={copy.errors.image_count_exceeded}
          errorSizeExceeded={copy.errors.image_size_exceeded}
          errorTypeInvalid={copy.errors.image_type_invalid}
          imageAttachmentsLabel={copy.imageAttachments}
          imageLimitLabel={copy.imageLimit}
          imageRemoveLabel={copy.imageRemove}
          ref={uploaderRef}
        />

        <select
          className="h-11 w-full rounded-lg border border-border bg-surface/80 px-3 text-sm font-semibold text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
          defaultValue="everyone"
          name="targetScope"
        >
          <option value="everyone">{copy.targetScopes.everyone}</option>
          <option value="roles">{copy.targetScopes.roles}</option>
        </select>

        <div className="grid gap-2 rounded-lg border border-border bg-background/60 p-3">
          <p className="text-xs font-black uppercase text-muted-foreground">
            {copy.roleTargets}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {organizationRoles.map((role) => (
              <label className="flex items-center gap-2 text-sm font-semibold" key={role}>
                <input name="targetRoles" type="checkbox" value={role} />
                {copy.targetRoles[role]}
              </label>
            ))}
          </div>
        </div>

        <select
          className="h-11 w-full rounded-lg border border-border bg-surface/80 px-3 text-sm font-semibold text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
          defaultValue="draft"
          name="status"
        >
          <option value="draft">{copy.statuses.draft}</option>
          <option value="published">{copy.statuses.published}</option>
        </select>

        <div className="grid gap-2 rounded-lg border border-border bg-background/60 p-3 text-sm font-semibold sm:grid-cols-2">
          <label className="flex items-center gap-2">
            <input name="isImportant" type="checkbox" />
            {copy.important}
          </label>
          <label className="flex items-center gap-2">
            <input name="isPinned" type="checkbox" />
            {copy.pinned}
          </label>
          <label className="flex items-center gap-2">
            <input name="showPopup" type="checkbox" />
            {copy.showPopup}
          </label>
          <label className="flex items-center gap-2">
            <input defaultChecked name="allowComments" type="checkbox" />
            {copy.allowComments}
          </label>
        </div>

        {clientError && (
          <p className="text-xs font-semibold text-destructive" role="alert">
            {clientError}
          </p>
        )}

        <Button className="w-full" disabled={isDisabled} type="submit">
          {copy.create}
        </Button>
      </form>
    </Card>
  );
}
