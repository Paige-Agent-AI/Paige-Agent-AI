import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import type { UserIdentity } from "@supabase/supabase-js";
import { AvatarUploader, isAvatarBucketUrl, removeAvatarObject } from "@/components/ui/avatar-uploader";
import { Loader2, User, Building2, Eye, EyeOff, Monitor, UserCircle, Link2, ShieldOff } from "lucide-react";
import { AccountSecurityPanel } from "@/components/settings/AccountSecurityPanel";
import { LiveSyncIndicator } from "@/components/ui/LiveSyncIndicator";
import { DataPrivacyPanel } from "@/components/dashboard/DataPrivacyPanel";
import { NotificationsSettings } from "@/components/dashboard/NotificationsSettings";
import { linkOAuthIdentity } from "@/integrations/auth/oauth";
import { CalendarConnectorsPanel } from "@/components/admin/settings/CalendarConnectorsPanel";
import { z } from "zod";
import { Switch } from "@/components/ui/switch";
import { useDashboardMode } from "@/contexts/DashboardModeContext";

const ssnSchema = z.string().regex(/^\d{3}-?\d{2}-?\d{4}$/, "Invalid SSN format (XXX-XX-XXXX)");

const ConnectedAccountsSection = () => {
  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [isLinking, setIsLinking] = useState(false);
  const { toast } = useToast();
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.identities) setIdentities(user.identities);
    };
    load();
  }, []);
  const hasGoogle = identities.some((i) => i.provider === "google");
  const linkGoogle = async () => {
    setIsLinking(true);
    try {
      const result = await linkOAuthIdentity("google", window.location.origin);
      if (result.error) toast({ title: "Linking failed", description: String(result.error), variant: "destructive" });
    } catch {
      toast({ title: "Error", description: "Failed to link Google account.", variant: "destructive" });
    } finally { setIsLinking(false); }
  };
  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold">Connected Accounts</h3>
          <p className="text-sm text-muted-foreground mt-1">Link external accounts for faster sign-in</p>
        </div>
        <div className="flex items-center justify-between p-4 rounded-lg border border-border">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            <div>
              <p className="font-medium text-sm">Google</p>
              <p className="text-xs text-muted-foreground">{hasGoogle ? "Connected" : "Not connected"}</p>
            </div>
          </div>
          {hasGoogle ? (
            <span className="text-xs text-[hsl(var(--success))] font-medium px-2 py-1 rounded-full bg-[hsl(var(--success)/0.1)]">Linked</span>
          ) : (
            <Button size="sm" variant="outline" onClick={linkGoogle} disabled={isLinking}>
              {isLinking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link Account"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

export const ProfileSettings = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isEditingPersonal, setIsEditingPersonal] = useState(false);
  const { toast } = useToast();
  const { mode, setMode, isAdmin } = useDashboardMode();

  // Honor a `?tab=` deep link (e.g. the post-connect redirect lands clients on
  // ?tab=accounts). Falls back to Personal for unknown/gated values.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const isValidTab =
    requestedTab === "personal" ||
    requestedTab === "business" ||
    requestedTab === "accounts" ||
    requestedTab === "privacy" ||
    (requestedTab === "preferences" && isAdmin);
  const [activeTab, setActiveTab] = useState(isValidTab ? (requestedTab as string) : "personal");

  // Realtime sync indicator state
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [justSynced, setJustSynced] = useState(false);
  const markSynced = (fromRealtime: boolean) => {
    setLastSyncAt(new Date());
    if (fromRealtime) {
      setJustSynced(true);
      setTimeout(() => setJustSynced(false), 1500);
      toast({ title: "Profile updated", description: "Synced from another session." });
    }
  };

  // Personal Info
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [savedAvatarUrl, setSavedAvatarUrl] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  
  // SSN and DOB - sensitive fields
  const [ssn, setSsn] = useState("");
  const [ssnLast4, setSsnLast4] = useState(""); // For display only
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [dobMasked, setDobMasked] = useState(""); // For display only
  const [showSsn, setShowSsn] = useState(false);
  const [isEditingSSN, setIsEditingSSN] = useState(false);
  const [isEditingDOB, setIsEditingDOB] = useState(false);

  // Business Info
  const [legalName, setLegalName] = useState("");
  const [dba, setDba] = useState("");
  const [ein, setEin] = useState("");
  const [entityType, setEntityType] = useState("");
  const [stateOfFormation, setStateOfFormation] = useState("");
  const [registeredAgentState, setRegisteredAgentState] = useState("");
  const [naics, setNaics] = useState("");

  useEffect(() => {
    loadProfileData().then(() => markSynced(false));
  }, []);

  // Realtime: pull in profile + business edits made elsewhere (admin drawer,
  // other devices) without requiring a page refresh. Skips reload while the
  // user is actively editing to avoid clobbering in-flight form changes.
  useEffect(() => {
    let cancelled = false;
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const schedule = () => {
      if (scheduled) return;
      scheduled = setTimeout(() => {
        scheduled = null;
        if (cancelled) return;
        if (isEditingPersonal || isEditingSSN || isEditingDOB) return;
        loadProfileData().then(() => markSynced(true));
      }, 400);
    };

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      channel = supabase
        .channel(`profile-self-${user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` }, schedule)
        .on("postgres_changes", { event: "*", schema: "public", table: "businesses", filter: `owner_user_id=eq.${user.id}` }, schedule)
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (scheduled) clearTimeout(scheduled);
      if (channel) supabase.removeChannel(channel);
    };
  }, [isEditingPersonal, isEditingSSN, isEditingDOB]);

  const loadProfileData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      // Load personal profile via PII-logged RPC (records read access to ssn/dob)
      const { data: profileRows } = await supabase
        .rpc("get_profile_with_pii_log", { _user_id: user.id });
      const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;

      // Avatar isn't part of the PII RPC surface — read it directly (own row).
      const { data: av } = await supabase
        .from("profiles").select("avatar_url").eq("user_id", user.id).maybeSingle();
      setAvatarUrl(av?.avatar_url || "");
      setSavedAvatarUrl(av?.avatar_url || "");

      if (profile) {
        setFullName(profile.full_name || "");
        setPhone(profile.phone || "");
        setAddress(profile.address || "");
        setCity(profile.city || "");
        setState(profile.state || "");
        setPostalCode(profile.postal_code || "");
        
        // Handle DOB - mask it if exists
        if (profile.date_of_birth) {
          const date = new Date(profile.date_of_birth);
          setDobMasked(`**/**/****`);
          setDateOfBirth("");
          setIsEditingDOB(false);
        }
        
        // Use the dedicated ssn_last_4 column for display (never derive from encrypted blob)
        if (profile.ssn_last_4) {
          setSsnLast4(profile.ssn_last_4);
          setSsn(""); // Never load full SSN into client state
          setIsEditingSSN(false);
        } else if (profile.ssn_encrypted) {
          // SSN is stored but last4 column not set — show masked placeholder
          setSsnLast4("****");
          setSsn("");
          setIsEditingSSN(false);
        }
      }

      // Load business profile
      const { data: business } = await supabase
        .from("businesses")
        .select("*")
        .eq("owner_user_id", user.id)
        .maybeSingle();

      if (business) {
        setLegalName(business.legal_name || "");
        setDba(business.dba || "");
        setEin(business.ein || "");
        setEntityType(business.entity_type || "");
        setStateOfFormation(business.state_of_formation || "");
        setRegisteredAgentState(business.registered_agent_state || "");
        setNaics(business.naics || "");
      }
    } catch (error) {
      console.error("Error loading profile:", error);
    }
  };

  const savePersonalInfo = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Validate SSN if provided (client-side check)
      if (ssn && isEditingSSN) {
        try {
          ssnSchema.parse(ssn);
        } catch (error) {
          toast({
            title: "Invalid SSN",
            description: "Please enter a valid SSN (XXX-XX-XXXX)",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
      }

      // Update non-sensitive fields directly
      const updateData: TablesUpdate<"profiles"> = {
        full_name: fullName,
        phone,
        address,
        city,
        state,
        postal_code: postalCode,
        avatar_url: avatarUrl,
      };

      const { error: profileError } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("user_id", user.id);
      // Tidy the replaced photo only after the new one is persisted.
      if (!profileError && savedAvatarUrl && savedAvatarUrl !== avatarUrl && isAvatarBucketUrl(savedAvatarUrl)) {
        void removeAvatarObject(savedAvatarUrl);
      }
      if (!profileError) setSavedAvatarUrl(avatarUrl);

      if (profileError) throw profileError;

      // Update SSN/DOB via paige-write-back edge function.
      // The edge function supplies the AES-256 encryption key from the
      // SSN_ENCRYPTION_KEY secret — the key never touches the browser.
      if ((ssn && isEditingSSN) || (dateOfBirth && isEditingDOB)) {
        const updates: { field_path: string; field_value: string }[] = [];

        if (ssn && isEditingSSN) {
          updates.push({ field_path: "profile.ssn", field_value: ssn.replace(/-/g, "") });
        }
        if (dateOfBirth && isEditingDOB) {
          updates.push({ field_path: "profile.date_of_birth", field_value: dateOfBirth });
        }

        const { error: ssnError } = await supabase.functions.invoke("paige-write-back", {
          body: { updates },
        });

        if (ssnError) throw ssnError;

        // Update local state
        if (ssn && isEditingSSN) {
          const cleanedSsn = ssn.replace(/-/g, "");
          setSsnLast4(cleanedSsn.slice(-4));
          setSsn("");
          setIsEditingSSN(false);
          setShowSsn(false);
        }

        if (dateOfBirth && isEditingDOB) {
          setDobMasked(`**/**/****`);
          setDateOfBirth("");
          setIsEditingDOB(false);
        }
      }

      toast({
        title: "Success",
        description: "Personal information updated successfully",
      });
      setIsEditingPersonal(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update personal information",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveBusinessInfo = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Check if business exists
      const { data: existing } = await supabase
        .from("businesses")
        .select("id")
        .eq("owner_user_id", user.id)
        .maybeSingle();

      if (existing) {
        // Update existing business
        const { error } = await supabase
          .from("businesses")
          .update({
            legal_name: legalName,
            dba,
            ein,
            entity_type: (entityType as "LLC" | "Corporation" | "Sole Proprietorship" | "Partnership" | null) || null,
            state_of_formation: stateOfFormation,
            registered_agent_state: registeredAgentState,
            naics,
          })
          .eq("owner_user_id", user.id);

        if (error) throw error;
      } else {
        // Create new business
        const { error } = await supabase
          .from("businesses")
          .insert({
            owner_user_id: user.id,
            legal_name: legalName,
            dba,
            ein,
            entity_type: (entityType as "LLC" | "Corporation" | "Sole Proprietorship" | "Partnership" | null) || null,
            state_of_formation: stateOfFormation,
            registered_agent_state: registeredAgentState,
            naics,
          });

        if (error) throw error;
      }

      toast({
        title: "Success",
        description: "Business information updated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update business information",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const usStates = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold mb-2">Profile Settings</h1>
          <p className="text-muted-foreground">Manage your personal and business information</p>
        </div>
        <LiveSyncIndicator lastUpdatedAt={lastSyncAt} justUpdated={justSynced} className="mt-2" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className={`grid w-full ${isAdmin ? "grid-cols-5" : "grid-cols-4"}`}>
          <TabsTrigger value="personal" className="gap-2">
            <User className="w-4 h-4" />
            Personal Info
          </TabsTrigger>
          <TabsTrigger value="business" className="gap-2">
            <Building2 className="w-4 h-4" />
            Business Info
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-2">
            <Link2 className="w-4 h-4" />
            Connected Accounts
          </TabsTrigger>
          <TabsTrigger value="privacy" className="gap-2">
            <ShieldOff className="w-4 h-4" />
            Data &amp; Privacy
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="preferences" className="gap-2">
              <Monitor className="w-4 h-4" />
              Preferences
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="privacy">
          <DataPrivacyPanel />
        </TabsContent>


        {isAdmin && (
          <TabsContent value="preferences">
            <Card className="p-6">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold">Dashboard Mode</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Choose your default post-login experience
                  </p>
                </div>
                
                <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <UserCircle className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {mode === "internal" ? "Internal Mode" : "Client Mode"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {mode === "internal"
                          ? "Team view — manage clients, pipeline, and follow-ups"
                          : "Client view — your own portal, tasks, and messages"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Client</span>
                    <Switch
                      checked={mode === "internal"}
                      onCheckedChange={(checked) => setMode(checked ? "internal" : "client")}
                    />
                    <span className="text-xs text-muted-foreground">Internal</span>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="accounts">
          <div className="space-y-8">
            <ConnectedAccountsSection />
            <div className="border-t border-border pt-8">
              <CalendarConnectorsPanel />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="personal">
          <Card className="p-6">
            {!isEditingPersonal ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Personal Information</h3>
                    <p className="text-sm text-muted-foreground">View your saved information</p>
                  </div>
                  <Button onClick={() => setIsEditingPersonal(true)} variant="outline">
                    Edit
                  </Button>
                </div>
                
                <div className="grid gap-3 pt-4">
                  {fullName && (
                    <div>
                      <Label className="text-muted-foreground">Full Name</Label>
                      <p className="font-medium">{fullName}</p>
                    </div>
                  )}
                  {phone && (
                    <div>
                      <Label className="text-muted-foreground">Phone</Label>
                      <p className="font-medium">{phone}</p>
                    </div>
                  )}
                  {address && (
                    <div>
                      <Label className="text-muted-foreground">Address</Label>
                      <p className="font-medium">{address}</p>
                      {city && state && (
                        <p className="font-medium">{city}, {state} {postalCode}</p>
                      )}
                    </div>
                  )}
                  {dobMasked && (
                    <div>
                      <Label className="text-muted-foreground">Date of Birth</Label>
                      <p className="font-medium">{dobMasked}</p>
                    </div>
                  )}
                  {ssnLast4 && (
                    <div>
                      <Label className="text-muted-foreground">SSN</Label>
                      <p className="font-medium">***-**-{ssnLast4}</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
              {userId && (
                <div className="space-y-2">
                  <Label>Profile photo</Label>
                  <AvatarUploader
                    userId={userId}
                    value={avatarUrl}
                    onChange={setAvatarUrl}
                    name={fullName}
                    size={72}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name *</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Street Address</Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="New York"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Select value={state} onValueChange={setState}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {usStates.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="postalCode">ZIP Code</Label>
                <Input
                  id="postalCode"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="10001"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dateOfBirth">Date of Birth</Label>
                  <Input
                    id="dateOfBirth"
                    type={isEditingDOB ? "date" : "text"}
                    value={isEditingDOB ? dateOfBirth : dobMasked}
                    onChange={(e) => {
                      setDateOfBirth(e.target.value);
                      setIsEditingDOB(true);
                    }}
                    onClick={() => {
                      if (!isEditingDOB && dobMasked) {
                        setIsEditingDOB(true);
                        setDateOfBirth("");
                      }
                    }}
                    placeholder={dobMasked || "Select date"}
                    readOnly={!isEditingDOB && !!dobMasked}
                  />
                  <p className="text-xs text-muted-foreground">
                    {dobMasked && !isEditingDOB ? "Click to update" : ""}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ssn">Social Security Number</Label>
                  <div className="relative">
                    <Input
                      id="ssn"
                      type={showSsn ? "text" : "password"}
                      value={isEditingSSN ? ssn : (ssnLast4 ? `***-**-${ssnLast4}` : "")}
                      onChange={(e) => {
                        setSsn(e.target.value);
                        setIsEditingSSN(true);
                      }}
                      onClick={() => {
                        if (!isEditingSSN && ssnLast4) {
                          setIsEditingSSN(true);
                          setSsn("");
                        }
                      }}
                      placeholder="XXX-XX-XXXX"
                      maxLength={11}
                      readOnly={!isEditingSSN && !!ssnLast4}
                    />
                    {isEditingSSN && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full"
                        onClick={() => setShowSsn(!showSsn)}
                      >
                        {showSsn ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ssnLast4 && !isEditingSSN ? "Click to update" : "Format: XXX-XX-XXXX"}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => setIsEditingPersonal(false)}
                  disabled={isLoading}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={savePersonalInfo}
                  disabled={isLoading || !fullName}
                  className="flex-1 bg-gradient-gold"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Personal Information"
                  )}
                </Button>
              </div>
            </div>
            )}
          </Card>

          <AccountSecurityPanel className="mt-6" />
        </TabsContent>

        <TabsContent value="business">
          <Card className="p-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="legalName">Legal Business Name *</Label>
                <Input
                  id="legalName"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="Acme Corporation"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dba">DBA (Doing Business As)</Label>
                <Input
                  id="dba"
                  value={dba}
                  onChange={(e) => setDba(e.target.value)}
                  placeholder="Acme Co"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ein">EIN (Employer ID Number)</Label>
                  <Input
                    id="ein"
                    value={ein}
                    onChange={(e) => setEin(e.target.value)}
                    placeholder="12-3456789"
                  />
                </div>

              <div className="space-y-2">
                <Label htmlFor="entityType">Entity Type</Label>
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LLC">LLC</SelectItem>
                    <SelectItem value="Corporation">Corporation</SelectItem>
                    <SelectItem value="Sole Proprietorship">Sole Proprietorship</SelectItem>
                    <SelectItem value="Partnership">Partnership</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="stateOfFormation">State of Formation</Label>
                  <Select value={stateOfFormation} onValueChange={setStateOfFormation}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {usStates.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="registeredAgentState">Registered Agent State</Label>
                  <Select value={registeredAgentState} onValueChange={setRegisteredAgentState}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {usStates.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="naics">NAICS Code</Label>
                <Input
                  id="naics"
                  value={naics}
                  onChange={(e) => setNaics(e.target.value)}
                  placeholder="541511"
                />
              </div>

              <Button
                onClick={saveBusinessInfo}
                disabled={isLoading || !legalName}
                className="w-full bg-gradient-gold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Business Information"
                )}
              </Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
