
/* One MIDI router for the page.

   `port.onmidimessage` is a single-handler PROPERTY, not an event target. Two
   instruments each assigning it means the second silently replaces the first, so on a
   page with both, whichever bound last received everything and the other was deaf —
   with no error and nothing in the console to suggest it.

   The router binds once and fans out. Channel routing does not move here: each
   instrument already filters by channel on the way in, and that is where it belongs —
   MS·1 splits synth, vocoder, bass and CC across four channels of its own, which is not
   something a shared router should have opinions about.

   The input port is the page's, like the tempo. Selecting one on either panel binds it
   for everything, and every panel's selector follows. */
Patchwork.midi = (() => {
"use strict";

let accessPromise = null, access = null, port = null;
const subs = [];                 // {id, onMidi, onPort}

/* One requestMIDIAccess for the page — two calls mean two permission paths and two
   onstatechange owners racing to rebuild the same port lists. */
function open(){
  if (accessPromise) return accessPromise;
  if (!navigator.requestMIDIAccess)
    return accessPromise = Promise.reject(new Error("unavailable"));
  accessPromise = navigator.requestMIDIAccess({sysex:false}).then(a => {
    access = a;
    a.onstatechange = () => {
      /* A port can vanish while bound — unplugging the interface. Drop the stale
         reference before telling anyone, or every subscriber re-reads a dead port. */
      if (port && !ports("inputs").some(p => p.id === port.id)) port = null;
      subs.forEach(s => { try{ s.onPort(port); }catch(e){} });
    };
    return a;
  });
  return accessPromise;
}

function ports(kind){ return access ? Array.from(access[kind].values()) : []; }

function fanout(e){
  /* A handler that throws must not stop the message reaching the other instruments. */
  subs.forEach(s => { try{ s.onMidi(e); }catch(err){ console.error("midi handler failed", err); } });
}

/* Register an instrument. onMidi gets every message — filter by channel yourself.
   onPort is called when the page's input changes, including when the OTHER panel
   changed it, so a selector and an LED can follow. */
function route(id, onMidi, onPort){
  subs.push({id, onMidi, onPort: onPort || function(){}});
}

function select(portId){
  if (port){ try{ port.onmidimessage = null; }catch(e){} }
  port = portId ? (ports("inputs").find(p => p.id === portId) || null) : null;
  if (port) port.onmidimessage = fanout;
  subs.forEach(s => { try{ s.onPort(port); }catch(e){} });
  return port;
}

return {open, ports, route, select,
        get access(){ return access; },
        get port(){ return port; }};
})();
