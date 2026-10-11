import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";
import { cn } from "../lib/utils";
import { useLocale } from "../lib/locale";

export interface Choice {
  value: string;
  label: string;
}
interface Props {
  id?: string;
  name?: string;
  options: Choice[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}
export function ChoiceSelect({
  id,
  options,
  onValueChange,
  placeholder,
  className,
  "aria-label": label,
  ...props
}: Props) {
  const { t } = useLocale();
  const hint = placeholder ?? t("Selecciona una opción");
  return (
    <Select
      items={options}
      onValueChange={(value) => onValueChange?.(value ?? "")}
      {...props}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        className={cn("w-full min-w-0", className)}
      >
        <SelectValue placeholder={hint}>
          {(value) =>
            options.find((option) => option.value === (value ?? ""))?.label ??
            hint
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
