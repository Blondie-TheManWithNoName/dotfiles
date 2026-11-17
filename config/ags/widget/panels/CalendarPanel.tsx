import { Variable } from "astal";
import { Gtk, astalify } from "astal/gtk3";

const Calendar = astalify(Gtk.Calendar);

const dateLabel = Variable("").poll(60_000, () =>
    new Date().toLocaleDateString("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    }),
);

export default function CalendarPanel() {
    return (
        <box vertical className="panel-content" spacing={6}>
            <label
                className="panel-title"
                label={dateLabel()}
                halign={Gtk.Align.START}
            />
            <Calendar className="panel-calendar" />
        </box>
    );
}
