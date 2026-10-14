import { useLocale } from "../lib/locale";
import { parseDateTime, zoneOffset } from "../shared/time";
import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es, enUS } from "date-fns/locale";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldLabel } from "./ui/field";
import { ChoiceSelect } from "./choice-select";
interface DateProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}
export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "Elige una fecha"
}: DateProps) {
  const { t, language, timeZone } = useLocale();
  const locale = language === "en" ? enUS : es;
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            id={id}
            variant="outline"
            className="w-full justify-start"
          />
        }
      >
        <CalendarIcon />
        {selected ? `${format(selected, "PP", { locale })} (${zoneOffset(timeZone, parseDateTime(`${value}T12:00`, timeZone) ?? undefined)})` : t(placeholder)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={locale}
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
        />
        <div className="border-t p-2">
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            {t("Limpiar fecha")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
const hours = Array.from({ length: 24 }, (_, i) => ({
  value: String(i).padStart(2, "0"),
  label: String(i).padStart(2, "0")
}));
const minutes = Array.from({ length: 60 }, (_, i) => ({
  value: String(i).padStart(2, "0"),
  label: String(i).padStart(2, "0")
}));
export function DateTimePicker({
  id,
  name,
  defaultValue = ""
}: {
  id: string;
  name: string;
  defaultValue?: string;
}) {
  const { t, timeZone } = useLocale();
  const [date, setDate] = useState(defaultValue.slice(0, 10)),
    [hour, setHour] = useState(defaultValue.slice(11, 13) || "00"),
    [minute, setMinute] = useState(defaultValue.slice(14, 16) || "00");
  const timestamp = date ? parseDateTime(`${date}T${hour}:${minute}`, timeZone) : null;
  return (
    <div className="flex flex-col gap-3">
      <DatePicker id={id} value={date} onChange={setDate} />
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-hour`}>{t("Hora ({zone})", { zone: zoneOffset(timeZone, timestamp ?? undefined) })}</FieldLabel>
          <ChoiceSelect
            id={`${id}-hour`}
            options={hours}
            value={hour}
            onValueChange={setHour}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-minute`}>{t("Minutos")}</FieldLabel>
          <ChoiceSelect
            id={`${id}-minute`}
            options={minutes}
            value={minute}
            onValueChange={setMinute}
          />
        </Field>
      </div>
      <Input
        type="hidden"
        name={name}
        value={date ? `${date}T${hour}:${minute}` : ""}
        readOnly
      />
    </div>
  );
}
