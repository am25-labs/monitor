import { useLocale } from "../lib/locale";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "./ui/field";
import type { Choice } from "./choice-select";
export function CheckboxList({
  id,
  name,
  label,
  options,
  value,
  onValueChange,
  defaultValue = []
}: {
  id: string;
  name: string;
  label: string;
  options: Choice[];
  defaultValue?: string[];
  value?: string[];
  onValueChange?: (value: string[]) => void;
}) {
  const { t } = useLocale();
  return (
    <FieldSet>
      <FieldLegend variant="label">{label}</FieldLegend>
      {options.length ? (
        <div className="flex max-h-52 flex-col gap-3 overflow-y-auto rounded-lg border p-3">
          {options.map((option) => (
            <Field key={option.value} orientation="horizontal">
              <Checkbox
                id={`${id}-${option.value}`}
                name={name}
                value={option.value}
                defaultChecked={
                  value === undefined
                    ? defaultValue.includes(option.value)
                    : undefined
                }
                checked={value?.includes(option.value)}
                onCheckedChange={(checked) => {
                  if (value && onValueChange)
                    onValueChange(
                      checked
                        ? [...value, option.value]
                        : value.filter((id) => id !== option.value)
                    );
                }}
              />
              <FieldLabel htmlFor={`${id}-${option.value}`}>
                {option.label}
              </FieldLabel>
            </Field>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("No hay opciones en este proyecto.")}
        </p>
      )}
    </FieldSet>
  );
}
