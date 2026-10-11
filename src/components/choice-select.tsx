import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./ui/select";
import { cn } from "../lib/utils";

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
  placeholder = "Seleccioná una opción",
  className,
  "aria-label": label,
  ...props
}: Props) {
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
        <SelectValue placeholder={placeholder}>
          {(value) =>
            options.find((option) => option.value === (value ?? ""))?.label ??
            placeholder
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
