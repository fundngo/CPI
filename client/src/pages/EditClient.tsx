import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Save, Plus, Trash2, X } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";
import { User, Building2, CreditCard as CreditCardIcon } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CARD_STATUSES,
  CLIENT_STATUSES,
  type CardStatus,
  type ClientStatus,
  type ClientWithDetails,
  type CreditCard,
} from "@shared/schema";

type EditableClient = Partial<ClientWithDetails>;
type EditableCard = Partial<CreditCard> & { _localId?: string; _new?: boolean };

export default function EditClient() {
  const [, params] = useRoute("/clients/:id/edit");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const id = Number(params?.id);

  const { data: client, isLoading } = useQuery<ClientWithDetails>({
    queryKey: ["/api/clients", id],
    enabled: Number.isFinite(id),
  });

  const [form, setForm] = useState<EditableClient>({});
  const [cards, setCards] = useState<EditableCard[]>([]);
  const [removedCardIds, setRemovedCardIds] = useState<number[]>([]);

  useEffect(() => {
    if (client) {
      setForm({ ...client });
      setCards(client.creditCards.map((c) => ({ ...c })));
      setRemovedCardIds([]);
    }
  }, [client]);

  function update<K extends keyof EditableClient>(key: K, value: EditableClient[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateCard(idx: number, patch: Partial<EditableCard>) {
    setCards((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function addCard() {
    setCards((cs) => [
      ...cs,
      {
        _localId: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        _new: true,
        cardName: "",
        issuer: "",
        creditLimit: 0,
        currentBalance: 0,
        minimumPayment: 0,
        paymentDueDate: "",
        accountStatus: "Current" as CardStatus,
        notes: "",
      },
    ]);
  }

  function removeCard(idx: number) {
    setCards((cs) => {
      const c = cs[idx];
      if (c.id && !c._new) {
        setRemovedCardIds((ids) => [...ids, c.id!]);
      }
      return cs.filter((_, i) => i !== idx);
    });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      // 1) PATCH the client record
      const clientPayload: Record<string, any> = {};
      const fields: (keyof ClientWithDetails)[] = [
        "name",
        "address",
        "phone",
        "email",
        "status",
        "onboardingDate",
        "numBankAccounts",
        "bankAccountsList",
        "bankAccountsAge",
        "hasSavings",
        "hasRetirement401k",
        "recentCreditReport",
        "equifaxScore",
        "experianScore",
        "transunionScore",
        "activeLLC",
        "llcName",
        "hasBusinessAccounts",
        "businessAccountsList",
        "businessAccountsAge",
        "generatingRevenue",
        "monthlyRevenue",
        "annualRevenue",
        "hasBusinessProducts",
        "businessCreditCards",
        "businessLoans",
        "businessLinesOfCredit",
        "gettingOffersInMail",
        "personalNotes",
        "businessNotes",
        "internalNotes",
        "recommendedNextSteps",
      ];
      for (const k of fields) {
        if (form[k] !== undefined) clientPayload[k as string] = form[k];
      }
      // Auto-build recentCreditReport string from bureau scores when override is blank
      const eq = form.equifaxScore;
      const ex = form.experianScore;
      const tu = form.transunionScore;
      const triParts: string[] = [];
      if (eq != null && eq !== 0) triParts.push(`Equifax ${eq}`);
      if (ex != null && ex !== 0) triParts.push(`Experian ${ex}`);
      if (tu != null && tu !== 0) triParts.push(`TransUnion ${tu}`);
      if (triParts.length > 0 && !form.recentCreditReport?.trim()) {
        clientPayload.recentCreditReport = triParts.join(", ");
      }
      await apiRequest("PATCH", `/api/clients/${id}`, clientPayload);

      // 2) Delete removed cards
      for (const cardId of removedCardIds) {
        await apiRequest("DELETE", `/api/cards/${cardId}`);
      }

      // 3) Create new cards / update existing
      for (const c of cards) {
        const payload = {
          cardName: c.cardName || "",
          issuer: c.issuer || "",
          creditLimit: Number(c.creditLimit || 0),
          currentBalance: Number(c.currentBalance || 0),
          minimumPayment: Number(c.minimumPayment || 0),
          paymentDueDate: c.paymentDueDate || "",
          accountStatus: (c.accountStatus || "Current") as CardStatus,
          notes: c.notes || "",
        };
        if (c._new || !c.id) {
          await apiRequest("POST", `/api/clients/${id}/cards`, payload);
        } else {
          await apiRequest("PATCH", `/api/cards/${c.id}`, payload);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", id] });
      toast({ title: "Changes saved" });
      setLocation(`/clients/${id}`);
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading || !client) {
    return (
      <div className="px-6 sm:px-10 py-10 max-w-5xl mx-auto">
        <div className="text-white/70">Loading…</div>
      </div>
    );
  }

  return (
    <div className="px-6 sm:px-10 py-10 max-w-5xl mx-auto pb-28">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setLocation(`/clients/${id}`)}
        className="mb-4 -ml-2 gap-1.5 text-white/70 hover:text-white hover:bg-white/10"
        data-testid="button-back-edit"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Profile
      </Button>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white" data-testid="text-edit-title">
            Edit Client
          </h1>
          <p className="text-sm text-white/70 mt-1">Update any information on this CPI sheet.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setLocation(`/clients/${id}`)}
            className="gap-2"
            data-testid="button-cancel-edit"
          >
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="gap-2"
            data-testid="button-save-edit"
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Basic info */}
        <SectionCard title="Basic Information" icon={<User className="h-5 w-5" />} testId="section-edit-basic">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <FormField label="Full Name">
              <Input
                value={form.name || ""}
                onChange={(e) => update("name", e.target.value)}
                data-testid="input-edit-name"
              />
            </FormField>
            <FormField label="Status">
              <Select
                value={(form.status as string) || "New"}
                onValueChange={(v) => update("status", v as ClientStatus)}
              >
                <SelectTrigger data-testid="select-edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Address" className="md:col-span-2">
              <Input
                value={form.address || ""}
                onChange={(e) => update("address", e.target.value)}
                data-testid="input-edit-address"
              />
            </FormField>
            <FormField label="Phone">
              <Input
                value={form.phone || ""}
                onChange={(e) => update("phone", e.target.value)}
                data-testid="input-edit-phone"
              />
            </FormField>
            <FormField label="Email">
              <Input
                type="email"
                value={form.email || ""}
                onChange={(e) => update("email", e.target.value)}
                data-testid="input-edit-email"
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Personal banking */}
        <SectionCard title="Personal Banking" icon={<User className="h-5 w-5" />} testId="section-edit-personal">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <FormField label="Number of Bank Accounts">
              <Input
                type="number"
                min={0}
                value={form.numBankAccounts ?? 0}
                onChange={(e) => update("numBankAccounts", Number(e.target.value))}
                data-testid="input-edit-num-bank"
              />
            </FormField>
            <FormField label="Account Age">
              <Input
                value={form.bankAccountsAge || ""}
                onChange={(e) => update("bankAccountsAge", e.target.value)}
                placeholder="e.g. 3 years"
                data-testid="input-edit-bank-age"
              />
            </FormField>
            <FormField label="Bank Accounts List" className="md:col-span-2">
              <Textarea
                rows={2}
                value={form.bankAccountsList || ""}
                onChange={(e) => update("bankAccountsList", e.target.value)}
                placeholder="Chase Checking, Ally Savings, ..."
                data-testid="input-edit-bank-list"
              />
            </FormField>
            <CheckboxRow
              label="Has Savings"
              checked={!!form.hasSavings}
              onChange={(v) => update("hasSavings", v)}
              testId="check-edit-savings"
            />
            <CheckboxRow
              label="Has Retirement / 401(k)"
              checked={!!form.hasRetirement401k}
              onChange={(v) => update("hasRetirement401k", v)}
              testId="check-edit-401k"
            />
            <FormField label="Equifax Score">
              <Input
                type="number"
                inputMode="numeric"
                min={300}
                max={850}
                value={form.equifaxScore ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  update("equifaxScore", v === "" ? null : Number(v));
                }}
                data-testid="input-edit-equifax"
              />
            </FormField>
            <FormField label="Experian Score">
              <Input
                type="number"
                inputMode="numeric"
                min={300}
                max={850}
                value={form.experianScore ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  update("experianScore", v === "" ? null : Number(v));
                }}
                data-testid="input-edit-experian"
              />
            </FormField>
            <FormField label="TransUnion Score">
              <Input
                type="number"
                inputMode="numeric"
                min={300}
                max={850}
                value={form.transunionScore ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  update("transunionScore", v === "" ? null : Number(v));
                }}
                data-testid="input-edit-transunion"
              />
            </FormField>
            <FormField label="Recent Credit Report (optional override)" className="md:col-span-2">
              <Input
                value={form.recentCreditReport || ""}
                onChange={(e) => update("recentCreditReport", e.target.value)}
                placeholder="Auto-built from scores above when blank"
                data-testid="input-edit-credit-report"
              />
            </FormField>
            <FormField label="Personal Notes" className="md:col-span-2">
              <Textarea
                rows={3}
                value={form.personalNotes || ""}
                onChange={(e) => update("personalNotes", e.target.value)}
                data-testid="input-edit-personal-notes"
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Business */}
        <SectionCard title="Business Information" icon={<Building2 className="h-5 w-5" />} testId="section-edit-business">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <CheckboxRow
              label="Active LLC"
              checked={!!form.activeLLC}
              onChange={(v) => update("activeLLC", v)}
              testId="check-edit-llc"
            />
            <FormField label="LLC Name">
              <Input
                value={form.llcName || ""}
                onChange={(e) => update("llcName", e.target.value)}
                data-testid="input-edit-llc-name"
              />
            </FormField>
            <CheckboxRow
              label="Has Business Bank Accounts"
              checked={!!form.hasBusinessAccounts}
              onChange={(v) => update("hasBusinessAccounts", v)}
              testId="check-edit-biz-acct"
            />
            <FormField label="Business Account Age">
              <Input
                value={form.businessAccountsAge || ""}
                onChange={(e) => update("businessAccountsAge", e.target.value)}
                data-testid="input-edit-biz-age"
              />
            </FormField>
            <FormField label="Business Accounts List" className="md:col-span-2">
              <Textarea
                rows={2}
                value={form.businessAccountsList || ""}
                onChange={(e) => update("businessAccountsList", e.target.value)}
                data-testid="input-edit-biz-list"
              />
            </FormField>
            <CheckboxRow
              label="Generating Revenue"
              checked={!!form.generatingRevenue}
              onChange={(v) => update("generatingRevenue", v)}
              testId="check-edit-revenue"
            />
            <CheckboxRow
              label="Getting Offers in Mail"
              checked={!!form.gettingOffersInMail}
              onChange={(v) => update("gettingOffersInMail", v)}
              testId="check-edit-offers"
            />
            <FormField label="Monthly Revenue ($)">
              <Input
                type="number"
                min={0}
                value={form.monthlyRevenue ?? 0}
                onChange={(e) => update("monthlyRevenue", Number(e.target.value))}
                data-testid="input-edit-monthly"
              />
            </FormField>
            <FormField label="Annual Revenue ($)">
              <Input
                type="number"
                min={0}
                value={form.annualRevenue ?? 0}
                onChange={(e) => update("annualRevenue", Number(e.target.value))}
                data-testid="input-edit-annual"
              />
            </FormField>
            <CheckboxRow
              label="Has Business Credit Products"
              checked={!!form.hasBusinessProducts}
              onChange={(v) => update("hasBusinessProducts", v)}
              testId="check-edit-biz-products"
            />
            <div />
            <FormField label="Business Credit Cards" className="md:col-span-2">
              <Textarea
                rows={2}
                value={form.businessCreditCards || ""}
                onChange={(e) => update("businessCreditCards", e.target.value)}
                data-testid="input-edit-biz-cards"
              />
            </FormField>
            <FormField label="Business Loans" className="md:col-span-2">
              <Textarea
                rows={2}
                value={form.businessLoans || ""}
                onChange={(e) => update("businessLoans", e.target.value)}
                data-testid="input-edit-biz-loans"
              />
            </FormField>
            <FormField label="Business Lines of Credit" className="md:col-span-2">
              <Textarea
                rows={2}
                value={form.businessLinesOfCredit || ""}
                onChange={(e) => update("businessLinesOfCredit", e.target.value)}
                data-testid="input-edit-biz-loc"
              />
            </FormField>
            <FormField label="Business Notes" className="md:col-span-2">
              <Textarea
                rows={3}
                value={form.businessNotes || ""}
                onChange={(e) => update("businessNotes", e.target.value)}
                data-testid="input-edit-biz-notes"
              />
            </FormField>
          </div>
        </SectionCard>

        {/* Credit cards */}
        <SectionCard
          title="Credit Cards"
          icon={<CreditCardIcon className="h-5 w-5" />}
          testId="section-edit-cards"
          description="Add, edit, or remove cards. Targets and paydown numbers update automatically."
        >
          <div className="pt-2 space-y-3">
            {cards.length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-edit-no-cards">
                No credit cards. Add one below.
              </div>
            )}
            {cards.map((card, idx) => (
              <Card
                key={card.id ?? card._localId ?? idx}
                className="p-4 border-card-border bg-card"
                data-testid={`edit-card-${idx}`}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                  <div className="lg:col-span-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Card Name
                    </Label>
                    <Input
                      value={card.cardName || ""}
                      onChange={(e) => updateCard(idx, { cardName: e.target.value })}
                      placeholder="Capital One Quicksilver"
                      data-testid={`input-edit-card-name-${idx}`}
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Issuer
                    </Label>
                    <Input
                      value={card.issuer || ""}
                      onChange={(e) => updateCard(idx, { issuer: e.target.value })}
                      placeholder="Capital One"
                      data-testid={`input-edit-card-issuer-${idx}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Limit ($)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={card.creditLimit ?? 0}
                      onChange={(e) => updateCard(idx, { creditLimit: Number(e.target.value) })}
                      data-testid={`input-edit-card-limit-${idx}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Balance ($)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={card.currentBalance ?? 0}
                      onChange={(e) => updateCard(idx, { currentBalance: Number(e.target.value) })}
                      data-testid={`input-edit-card-balance-${idx}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Min Pmt ($)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={card.minimumPayment ?? 0}
                      onChange={(e) => updateCard(idx, { minimumPayment: Number(e.target.value) })}
                      data-testid={`input-edit-card-minpmt-${idx}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Status
                    </Label>
                    <Select
                      value={(card.accountStatus as string) || "Current"}
                      onValueChange={(v) => updateCard(idx, { accountStatus: v as CardStatus })}
                    >
                      <SelectTrigger data-testid={`select-edit-card-status-${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CARD_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Due Date
                    </Label>
                    <Input
                      value={card.paymentDueDate || ""}
                      onChange={(e) => updateCard(idx, { paymentDueDate: e.target.value })}
                      placeholder="MM/DD"
                      data-testid={`input-edit-card-due-${idx}`}
                    />
                  </div>
                  <div className="flex items-end justify-end lg:col-span-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeCard(idx)}
                      className="gap-1.5 text-destructive hover:text-destructive"
                      data-testid={`button-remove-card-${idx}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={addCard}
              className="gap-2 w-full"
              data-testid="button-add-card"
            >
              <Plus className="h-4 w-4" />
              Add Credit Card
            </Button>
          </div>
        </SectionCard>

        {/* Notes */}
        <SectionCard title="Internal & Recommendations" testId="section-edit-notes">
          <div className="grid grid-cols-1 gap-4 pt-2">
            <FormField label="Recommended Next Steps (notes)">
              <Textarea
                rows={3}
                value={form.recommendedNextSteps || ""}
                onChange={(e) => update("recommendedNextSteps", e.target.value)}
                data-testid="input-edit-rec-steps"
              />
            </FormField>
            <FormField label="Internal Notes">
              <Textarea
                rows={3}
                value={form.internalNotes || ""}
                onChange={(e) => update("internalNotes", e.target.value)}
                data-testid="input-edit-internal-notes"
              />
            </FormField>
          </div>
        </SectionCard>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => setLocation(`/clients/${id}`)}
            className="gap-2"
            data-testid="button-cancel-edit-bottom"
          >
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="gap-2"
            data-testid="button-save-edit-bottom"
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className || ""}`}>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="flex items-center gap-2 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-emerald-600"
        data-testid={testId}
      />
      <span className="text-sm text-card-foreground">{label}</span>
    </label>
  );
}
