import { initials } from "./formatters.js";
import { providerBrand } from "./providerBrand.js";

/** Provider avatar: real brand logo when known, else initials tinted with the provider's brand color. */
export function Avatar({ providerName, className }: { readonly providerName: string; readonly className?: string }) {
  const { logoUrl, color } = providerBrand(providerName);
  const classes = className === undefined ? "avatar" : `avatar ${className}`;
  if (logoUrl === undefined) {
    return (
      <span className={classes} title={providerName} style={{ background: `#${color}`, color: "#fff" }}>
        {initials(providerName)}
      </span>
    );
  }
  return (
    <span className={classes} title={providerName} style={{ background: "#fff" }}>
      <img className="avatar-logo" src={logoUrl} alt="" />
    </span>
  );
}
