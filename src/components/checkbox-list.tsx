import { Checkbox } from "./ui/checkbox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "./ui/field";
import type { Choice } from "./choice-select";
export function CheckboxList({
  id,
  name,
  label,
  options,
  defaultValue = []
}: {
  id: string;
  name: string;
  label: string;
  options: Choice[];
  defaultValue?: string[];
}) {
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
                defaultChecked={defaultValue.includes(option.value)}
              />
              <FieldLabel htmlFor={`${id}-${option.value}`}>
                {option.label}
              </FieldLabel>
            </Field>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No hay opciones en este proyecto.
        </p>
      )}
    </FieldSet>
  );
}
