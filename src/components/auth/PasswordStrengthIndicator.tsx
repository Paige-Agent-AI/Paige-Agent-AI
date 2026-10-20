import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { passwordRequirementChecks } from "@/lib/auth/passwordPolicy";

/**
 * Single source of truth for the account password minimum, shared by every
 * self-service surface that sets a password (the Account Security panel and the
 * recovery ResetPassword page) so the gate never disagrees between flows.
 * Set to 8 (the stronger of the two prior values — the panel already used 8;
 * ResetPassword used 6) so consolidating never weakens either flow.
 */
export const MIN_PASSWORD_LENGTH = 8;

interface Props {
  password: string;
}

const getStrength = (pw: string) => {
  const c = passwordRequirementChecks(pw);
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (c.uppercase) score++;
  if (c.digit) score++;
  if (c.symbol) score++;
  return score;
};

const labels = ["Very Weak", "Weak", "Fair", "Good", "Strong"];
const colors = [
  "bg-red-500",
  "bg-orange-500",
  "bg-yellow-500",
  "bg-emerald-400",
  "bg-emerald-500",
];

export const PasswordStrengthIndicator = ({ password }: Props) => {
  const strength = useMemo(() => getStrength(password), [password]);
  const checks = useMemo(() => passwordRequirementChecks(password), [password]);

  if (!password) return null;

  return (
    <div className="space-y-2 pt-1">
      {/* Bar */}
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              i < strength ? colors[strength - 1] : "bg-muted"
            }`}
          />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Strength: <span className="font-medium text-foreground">{labels[Math.max(0, strength - 1)]}</span>
      </p>

      {/* Requirements — derived from the same server policy the signup
          schema enforces, so the visible checks never contradict submit. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
        {[
          { met: checks.length, label: "6+ characters" },
          { met: checks.lowercase, label: "Lowercase letter" },
          { met: checks.uppercase, label: "Uppercase letter" },
          { met: checks.digit, label: "Number" },
          { met: checks.symbol, label: "Symbol (e.g. !@#$%)" },
        ].map((r) => (
          <div key={r.label} className="flex items-center gap-1">
            {r.met ? (
              <Check className="w-3 h-3 text-emerald-500" />
            ) : (
              <X className="w-3 h-3 text-muted-foreground/40" />
            )}
            <span className={r.met ? "text-emerald-600" : "text-muted-foreground/60"}>{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
