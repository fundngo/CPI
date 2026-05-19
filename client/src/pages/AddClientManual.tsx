import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CLIENT_STATUSES } from "@shared/schema";
import type { Client } from "@shared/schema";
import { ArrowLeft, UserPlus } from "lucide-react";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional().default(""),
  email: z.string().email("Invalid email").or(z.literal("")).optional().default(""),
  onboardingDate: z.string().optional().default(""),
  status: z.enum(CLIENT_STATUSES).default("New"),
});

type FormVals = z.infer<typeof schema>;

export default function AddClientManual() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      onboardingDate: new Date().toISOString().slice(0, 10),
      status: "New",
    },
  });

  const mutation = useMutation({
    mutationFn: async (vals: FormVals) => {
      const res = await apiRequest("POST", "/api/clients", vals);
      return (await res.json()) as Client;
    },
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client created", description: `${client.name} is now in your dashboard.` });
      setLocation(`/clients/${client.id}`);
    },
    onError: (e: Error) => {
      toast({ title: "Couldn't create client", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="px-10 py-10 max-w-3xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setLocation("/clients/new")}
        className="mb-4 -ml-2 gap-1.5 text-white/70 hover:text-white hover:bg-white/10"
        data-testid="button-back-upload"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to upload
      </Button>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3" data-testid="text-add-client-title">
          <UserPlus className="h-7 w-7 text-primary" />
          Add Client Manually
        </h1>
        <p className="text-base text-white/70 mt-2">
          Start with the basics. You can attach documents from the client profile later.
        </p>
      </header>

      <Card className="p-8 border-card-border shadow-xl ring-1 ring-white/5 rounded-xl">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((vals) => mutation.mutate(vals))}
            className="space-y-5"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Maria Rodriguez" {...field} data-testid="input-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input placeholder="(555) 555-0123" {...field} data-testid="input-phone" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="name@example.com" {...field} data-testid="input-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="onboardingDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Onboarding Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} data-testid="input-onboarding-date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-status">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CLIENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setLocation("/")} className="rounded-lg px-5" data-testid="button-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending} className="rounded-lg px-6 font-medium" data-testid="button-create-client">
                {mutation.isPending ? "Creating…" : "Create Client"}
              </Button>
            </div>
          </form>
        </Form>
      </Card>
    </div>
  );
}
