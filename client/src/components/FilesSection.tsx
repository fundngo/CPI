import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Upload,
  FileText,
  Image as ImageIcon,
  IdCard,
  Building2,
  Banknote,
  File as FileIcon,
  Trash2,
  Download,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { UpdateReviewModal } from "@/components/UpdateReviewModal";
import { FILE_TYPES } from "@shared/schema";
import type { FileType, UploadedFile } from "@shared/schema";
import { fmtDate } from "@/lib/calculations";

const TYPE_LABELS: Record<FileType, string> = {
  credit_report: "Credit Reports",
  bank_statement: "Bank Statements",
  business_doc: "Business Docs",
  id_doc: "IDs",
  photo: "Photos",
  other: "Other",
};

const TYPE_ICONS: Record<FileType, React.ComponentType<any>> = {
  credit_report: FileText,
  bank_statement: Banknote,
  business_doc: Building2,
  id_doc: IdCard,
  photo: ImageIcon,
  other: FileIcon,
};

function detectType(name: string): FileType {
  const n = name.toLowerCase();
  if (n.includes("credit") && (n.endsWith(".pdf") || n.includes("report"))) return "credit_report";
  if (n.includes("statement") || n.includes("bank")) return "bank_statement";
  if (n.includes("llc") || n.includes("business") || n.includes("ein") || n.includes("articles")) return "business_doc";
  if (n.includes("id") || n.includes("passport") || n.includes("license") || n.includes("dl")) return "id_doc";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") || n.endsWith(".webp")) return "photo";
  return "other";
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function FilesSection({ clientId, files }: { clientId: number; files: UploadedFile[] }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [pendingType, setPendingType] = useState<FileType>("other");

  const uploadMutation = useMutation({
    mutationFn: async (payload: { fileName: string; fileType: FileType; fileSize: number; base64Content: string }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/files`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/files/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      toast({ title: "File deleted" });
    },
  });

  const [reviewOpen, setReviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/preview-from-files`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      setPreviewData(data);
      setReviewOpen(true);
      if (data?.errors?.length && !data.creditReport && !data.bankStatement) {
        toast({
          title: "Could not extract data",
          description: data.errors.join("; "),
          variant: "destructive",
        });
        setReviewOpen(false);
      }
    },
    onError: (e: any) => {
      toast({ title: "Update failed", description: e?.message || "Try again", variant: "destructive" });
    },
  });

  const onDrop = useCallback(
    async (accepted: File[]) => {
      setUploading(true);
      try {
        for (const file of accepted) {
          const buf = await file.arrayBuffer();
          const base64 = arrayBufferToBase64(buf);
          await uploadMutation.mutateAsync({
            fileName: file.name,
            fileType: pendingType === "other" ? detectType(file.name) : pendingType,
            fileSize: file.size,
            base64Content: base64,
          });
        }
        toast({ title: `Uploaded ${accepted.length} file${accepted.length === 1 ? "" : "s"}` });
      } catch (e: any) {
        toast({ title: "Upload failed", description: e.message, variant: "destructive" });
      } finally {
        setUploading(false);
      }
    },
    [pendingType, uploadMutation, toast]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  async function handleDownload(file: UploadedFile) {
    try {
      const res = await apiRequest("GET", `/api/files/${file.id}`);
      const full = await res.json();
      const link = document.createElement("a");
      link.href = `data:application/octet-stream;base64,${full.base64Content}`;
      link.download = full.fileName;
      link.click();
    } catch (e: any) {
      toast({ title: "Download failed", description: e.message, variant: "destructive" });
    }
  }

  // Group files
  const groups: Record<FileType, UploadedFile[]> = {
    credit_report: [],
    bank_statement: [],
    business_doc: [],
    id_doc: [],
    photo: [],
    other: [],
  };
  for (const f of files) groups[(f.fileType as FileType) ?? "other"].push(f);

  return (
    <div className="space-y-5">
      <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors bg-card ${isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/20"}`} data-testid="dropzone-files">
        <input {...getInputProps()} data-testid="input-file-upload" />
        <Upload className="h-9 w-9 mx-auto text-primary mb-3" strokeWidth={1.8} />
        <div className="text-base font-semibold text-foreground">
          {isDragActive ? "Drop files here…" : uploading ? "Uploading…" : "Drag & drop files, or click to browse"}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          PDFs, statements, ID photos. Stored securely in the client's record.
        </div>
        <div className="flex items-center justify-center gap-2 mt-4">
          <span className="text-xs text-muted-foreground">Tag uploads as:</span>
          <Select value={pendingType} onValueChange={(v) => setPendingType(v as FileType)}>
            <SelectTrigger className="h-8 w-44 text-sm" onClick={(e) => e.stopPropagation()} data-testid="select-pending-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="default"
          size="sm"
          className="gap-2"
          data-testid="button-refresh-from-files"
          disabled={previewMutation.isPending || files.length === 0}
          onClick={() => previewMutation.mutate()}
        >
          <RefreshCw className={`h-4 w-4 ${previewMutation.isPending ? "animate-spin" : ""}`} />
          {previewMutation.isPending ? "Extracting…" : "Update from latest files"}
        </Button>
        <div className="text-xs text-muted-foreground">
          <Sparkles className="inline h-3 w-3 text-accent mr-1" />
          Re-parses the most recent files — you'll review before anything saves.
        </div>
      </div>

      <div className="space-y-4">
        {(Object.entries(groups) as [FileType, UploadedFile[]][])
          .filter(([, list]) => list.length > 0)
          .map(([type, list]) => {
            const Icon = TYPE_ICONS[type];
            return (
              <div key={type} data-testid={`group-files-${type}`}>
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2 flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {TYPE_LABELS[type]} ({list.length})
                </div>
                <div className="space-y-1.5">
                  {list.map((file) => {
                    const FIcon = TYPE_ICONS[file.fileType as FileType] ?? FileIcon;
                    return (
                      <div
                        key={file.id}
                        className="flex items-center gap-3 px-3 py-2 border border-border rounded-md bg-card hover:bg-muted/30 transition-colors"
                        data-testid={`row-file-${file.id}`}
                      >
                        <FIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate" data-testid={`text-file-name-${file.id}`}>{file.fileName}</div>
                          <div className="text-xs text-muted-foreground">
                            {fmtSize(file.fileSize)} · {fmtDate(file.uploadedAt)}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs">{TYPE_LABELS[file.fileType as FileType]}</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDownload(file)}
                          data-testid={`button-download-file-${file.id}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate(file.id)}
                          data-testid={`button-delete-file-${file.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        {files.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-files">
            No files uploaded yet.
          </div>
        )}
      </div>

      <UpdateReviewModal
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        clientId={clientId}
        preview={previewData}
      />
    </div>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
