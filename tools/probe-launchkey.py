#!/usr/bin/env python3
"""Ask a Launchkey MK4 what it thinks it is set to, over CoreMIDI, with no browser involved.

    python3 -m venv .venv && .venv/bin/pip install python-rtmidi
    .venv/bin/python tools/probe-launchkey.py

Why this exists: shell/launchkey.js takes its numbers from Novation's Programmer's Reference,
and the reference has been wrong about this device more than once. `Patchwork.surface.traffic`
in the app is the usual way to check, but it needs a browser that has been granted Web MIDI —
and the in-app preview pane never is, and the extension is not always connected. This asks
the same questions straight down the cable.

What it does, in order: listens passively; sends a universal device inquiry on both ports;
asks the feature channel for the pad layout, encoder layout, drum-rack owner and display
timeout; enters DAW mode and asks again; sets every encoder layout 0-15 and asks which stuck;
sets the display timeout to 5, 0 and 10 and reads each back; then puts every one of those
back to what it found and leaves DAW mode in the state it found it.

⚠️ IT DOES DISTURB A LIVE PAGE. Leaving and re-entering DAW mode makes the device announce
its standalone layouts, and a connected surface will follow them — the app hops to whatever
view encoder layout 6 is bound to, and its LED cache no longer matches the pads. Disconnect
and reconnect the controller in Settings afterwards, or close the tab first.

⚠️ THE DISPLAY TIMEOUT IS NON-VOLATILE. This script reads it before writing and restores it,
but if it dies half-way the device keeps whatever was last written. Run it to the end.

It never touches pad LEDs, button LEDs or screen text.
"""
import sys
import time

try:
    import rtmidi
except ImportError:
    sys.exit("python-rtmidi is not installed — see the docstring at the top of this file")


def hx(b):
    return " ".join("%02x" % x for x in b)


FEAT, ASK = 0xB6, 0xB7
F_PADS, F_ENCS, F_DRUM, F_TIMEOUT = 0x1D, 0x1E, 0x54, 0x71
DAW_ON, DAW_OFF, FEAT_ON = [0x9F, 0x0C, 0x7F], [0x9F, 0x0C, 0x00], [0x9F, 0x0B, 0x7F]
INQUIRY = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]
NAMED = {F_PADS: "pad layout", F_ENCS: "encoder layout", F_DRUM: "drum rack", F_TIMEOUT: "display timeout"}


def find(names, word):
    for i, n in enumerate(names):
        if "launchkey" in n.lower() and word in n.lower():
            return i
    return None


def main():
    scan_in, scan_out = rtmidi.MidiIn(), rtmidi.MidiOut()
    inames, onames = scan_in.get_ports(), scan_out.get_ports()
    idx = (find(inames, "daw"), find(inames, "midi"), find(onames, "daw"), find(onames, "midi"))
    if None in idx:
        sys.exit("no Launchkey with both a DAW and a MIDI port; inputs=%r outputs=%r" % (inames, onames))
    daw_in_i, midi_in_i, daw_out_i, midi_out_i = idx
    print("ports  DAW in=%r  MIDI in=%r\n       DAW out=%r  MIDI out=%r" % (
        inames[daw_in_i], inames[midi_in_i], onames[daw_out_i], onames[midi_out_i]))

    log = []

    def listener(tag):
        def cb(ev, data=None):
            log.append((tag, list(ev[0])))
        return cb

    daw_in = rtmidi.MidiIn(); daw_in.ignore_types(sysex=False); daw_in.open_port(daw_in_i); daw_in.set_callback(listener("DAW "))
    midi_in = rtmidi.MidiIn(); midi_in.ignore_types(sysex=False); midi_in.open_port(midi_in_i); midi_in.set_callback(listener("MIDI"))
    daw_out = rtmidi.MidiOut(); daw_out.open_port(daw_out_i)
    midi_out = rtmidi.MidiOut(); midi_out.open_port(midi_out_i)

    mark = [0]

    def flush(title, wait=0.25):
        time.sleep(wait)
        new = log[mark[0]:]; mark[0] = len(log)
        print("\n== %s" % title)
        if not new:
            print("   (nothing)")
        for tag, m in new:
            print("   %s <- %s" % (tag, hx(m)))
        return [m for _, m in new]

    def send(port, b, label=""):
        print("   %s -> %s   %s" % ("DAW " if port is daw_out else "MIDI", hx(b), label))
        port.send_message(b)

    def reply(msgs, cc):
        for m in msgs:
            if len(m) == 3 and m[0] == FEAT and m[1] == cc:
                return m[2]
        return None

    def ask_all(title):
        for cc in (F_PADS, F_ENCS, F_DRUM, F_TIMEOUT):
            send(daw_out, [ASK, cc, 0], "ask " + NAMED[cc])
        got = flush(title)
        vals = {cc: reply(got, cc) for cc in NAMED}
        print("   " + "  ".join("%s=%r" % (NAMED[cc], v) for cc, v in vals.items()))
        return vals

    flush("passive listen, 1.5 s", 1.5)

    send(daw_out, INQUIRY, "device inquiry")
    inq_daw = flush("inquiry reply via DAW port")
    send(midi_out, INQUIRY, "device inquiry")
    inq_midi = flush("inquiry reply via MIDI port")

    before = ask_all("answers before touching DAW mode")
    # Standalone reports pad layout 1 and a Custom encoder layout; a DAW-owned device reports
    # pad layout 2 and one of the named layouts. That is the only tell there is.
    was_daw = before[F_PADS] == 2 or before[F_ENCS] in (1, 2, 4, 5)
    print("   looks like it was %s" % ("IN DAW MODE already (a page is probably connected)" if was_daw else "standalone"))

    send(daw_out, DAW_ON, "DAW mode on")
    send(daw_out, FEAT_ON, "feature controls on")
    flush("spontaneous reports after DAW on", 0.5)
    inside = ask_all("answers in DAW mode")

    print("\n== encoder layout sweep 0..15 (set, then ask)")
    accepted = {}
    for n in range(16):
        daw_out.send_message([FEAT, F_ENCS, n]); time.sleep(0.15)
        daw_out.send_message([ASK, F_ENCS, 0]); time.sleep(0.15)
        got = [m for _, m in log[mark[0]:]]; mark[0] = len(log)
        ans = reply(got, F_ENCS)
        accepted[n] = ans
        extra = [hx(m) for m in got if not (len(m) == 3 and m[0] == FEAT and m[1] == F_ENCS)]
        print("   set %2d -> device says %-4r%s" % (n, ans, ("  also: " + "; ".join(extra)) if extra else ""))

    to0 = before[F_TIMEOUT] if before[F_TIMEOUT] is not None else inside[F_TIMEOUT]
    if to0 is None:
        print("\n== display timeout query unanswered; not touching it")
    else:
        for v in (5, 0, 10):
            send(daw_out, [FEAT, F_TIMEOUT, v], "set timeout %d" % v)
            send(daw_out, [ASK, F_TIMEOUT, 0], "ask timeout")
            print("   reads back: %r" % reply(flush("timeout after setting %d" % v), F_TIMEOUT))
        send(daw_out, [FEAT, F_TIMEOUT, to0], "restore timeout %d" % to0)
        send(daw_out, [ASK, F_TIMEOUT, 0], "ask timeout")
        print("   reads back: %r (wanted %r)" % (reply(flush("timeout restored"), F_TIMEOUT), to0))

    print("\n== putting it back")
    if was_daw:
        for cc in (F_PADS, F_ENCS, F_DRUM):
            v = before[cc] if before[cc] is not None else inside[cc]
            if v is not None:
                send(daw_out, [FEAT, cc, v], "restore " + NAMED[cc])
        flush("left in DAW mode, as found")
    else:
        send(daw_out, DAW_OFF, "DAW mode off, as found")
        flush("standalone reports after DAW off", 0.5)

    print("\nSUMMARY")
    print("  inquiry via DAW :", [hx(m) for m in inq_daw if m and m[0] == 0xF0])
    print("  inquiry via MIDI:", [hx(m) for m in inq_midi if m and m[0] == 0xF0])
    print("  before:", {NAMED[k]: v for k, v in before.items()})
    print("  in DAW:", {NAMED[k]: v for k, v in inside.items()})
    print("  encoder layouts the device keeps:", sorted(k for k, v in accepted.items() if v == k))
    print("  every sweep answer:", accepted)


if __name__ == "__main__":
    main()
