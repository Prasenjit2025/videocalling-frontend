import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const socket: Socket = io("http://127.0.0.1:5000", { transports: ["websocket"] });

interface User { id: string; username: string; busy: boolean; }
interface Message { sender: string; text: string; time: string; }

function App() {
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const [loggedIn, setLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [incomingCall, setIncomingCall] = useState<any>(null);
  
  // Chat History mapped by User ID
  const [chatHistory, setChatHistory] = useState<{ [key: string]: Message[] }>({});
  const [chatInput, setChatInput] = useState("");

  useEffect(() => {
    socket.on("login-success", () => setLoggedIn(true));
    socket.on("online-users", (list: User[]) => setUsers(list.filter(u => u.id !== socket.id)));
    socket.on("incoming-call", (data) => setIncomingCall(data));

    socket.on("call-accepted", async ({ answer }) => {
      if (peerRef.current) {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        while (pendingCandidates.current.length > 0) {
          const c = pendingCandidates.current.shift();
          if (c) await peerRef.current.addIceCandidate(new RTCIceCandidate(c));
        }
      }
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      if (peerRef.current?.remoteDescription) {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        pendingCandidates.current.push(candidate);
      }
    });

    socket.on("receive-message", ({ from, message, time }) => {
      setChatHistory(prev => ({
        ...prev,
        [from]: [...(prev[from] || []), { sender: "Partner", text: message, time }]
      }));
    });

    socket.on("call-ended", cleanupCall);

    return () => { socket.off(); };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, selectedUser]);

  useEffect(() => {
    if (loggedIn) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
        localStreamRef.current = stream;
        if (localVideo.current) localVideo.current.srcObject = stream;
      });
    }
  }, [loggedIn]);

  const createPeer = (targetId: string) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    localStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
    pc.ontrack = (e) => { if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0]; };
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit("ice-candidate", { to: targetId, candidate: e.candidate });
    };
    peerRef.current = pc;
    return pc;
  };

  const callUser = async () => {
    if (!selectedUser) return;
    const pc = createPeer(selectedUser.id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("call-user", { to: selectedUser.id, offer });
  };

  const acceptCall = async () => {
    const pc = createPeer(incomingCall.from);
    setSelectedUser({ id: incomingCall.from, username: incomingCall.callerName, busy: true });
    await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer-call", { to: incomingCall.from, answer });
    setIncomingCall(null);
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedUser) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const targetId = selectedUser.id;

    socket.emit("send-message", { to: targetId, message: chatInput });
    setChatHistory(prev => ({
      ...prev,
      [targetId]: [...(prev[targetId] || []), { sender: "You", text: chatInput, time }]
    }));
    setChatInput("");
  };

  function cleanupCall() {
    peerRef.current?.close();
    peerRef.current = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    setSelectedUser(null);
  }

  if (!loggedIn) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-950 text-white font-sans">
      <div className="bg-slate-900 p-8 rounded-2xl shadow-2xl w-80 border border-slate-800">
        <h2 className="text-3xl font-bold mb-6 text-center text-blue-500">Connect</h2>
        <input className="w-full p-3 mb-3 bg-slate-800 rounded-lg border border-slate-700" placeholder="Username" onChange={e => setUsername(e.target.value)} />
        <input className="w-full p-3 mb-6 bg-slate-800 rounded-lg border border-slate-700" type="password" placeholder="Password" onChange={e => setPassword(e.target.value)} />
        <button className="w-full bg-blue-600 py-3 rounded-xl font-bold hover:bg-blue-500 transition-all" onClick={() => socket.emit("login", { username, password })}>Sign In</button>
      </div>
    </div>
  );

  const currentMessages = selectedUser ? chatHistory[selectedUser.id] || [] : [];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Logged in as</p>
          <h1 className="text-xl font-bold text-blue-400">{username}</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="text-xs text-slate-500 mb-4 font-bold uppercase">Contacts</h2>
          {users.map(u => (
            <button key={u.id} onClick={() => setSelectedUser(u)}
              className={`w-full text-left p-4 rounded-xl mb-2 flex items-center justify-between transition-all ${selectedUser?.id === u.id ? 'bg-blue-600 shadow-lg shadow-blue-900/20' : 'bg-slate-800 hover:bg-slate-700'}`}>
              <span className="font-medium">{u.username}</span>
              {u.busy && <span className="text-[10px] bg-red-500 px-2 py-0.5 rounded-full">Busy</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50 backdrop-blur-md">
          <h2 className="text-lg font-semibold">
            {selectedUser ? `Chat with ${selectedUser.username}` : "Select a contact to begin"}
          </h2>
          {selectedUser && (
            <div className="flex gap-3">
              <button onClick={callUser} disabled={selectedUser.busy} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 px-6 py-2 rounded-full font-bold transition-all">Start Call</button>
              <button onClick={() => { socket.emit("end-call", { to: selectedUser.id }); cleanupCall(); }} className="bg-rose-600 hover:bg-rose-500 px-6 py-2 rounded-full font-bold transition-all">End Session</button>
            </div>
          )}
        </header>

        <main className="flex-1 flex p-6 gap-6 overflow-hidden">
          {/* Video Grid */}
          <div className="flex-2 flex flex-col gap-6">
            <div className="relative flex-1 bg-black rounded-3xl border border-slate-800 overflow-hidden shadow-2xl">
              <video ref={remoteVideo} autoPlay playsInline className="w-full h-full object-cover" />
              <div className="absolute top-4 left-4 bg-black/60 px-3 py-1 rounded-full text-xs">Incoming Feed</div>
            </div>
            <div className="h-48 flex justify-end">
              <div className="w-72 relative rounded-2xl border border-slate-700 bg-black overflow-hidden shadow-xl">
                <video ref={localVideo} autoPlay muted playsInline className="w-full h-full object-cover" />
                <div className="absolute top-2 left-2 bg-black/60 px-2 py-0.5 rounded-full text-[10px]">Your Camera</div>
              </div>
            </div>
          </div>

          {/* Chat Panel */}
          <div className="flex-1 bg-slate-900 rounded-3xl border border-slate-800 flex flex-col shadow-2xl overflow-hidden">
            <div className="flex-1 p-6 overflow-y-auto space-y-4">
              {currentMessages.length === 0 && (
                <div className="h-full flex items-center justify-center text-slate-600 text-sm italic">
                  No messages yet. Say hello!
                </div>
              )}
              {currentMessages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.sender === "You" ? "items-end" : "items-start"}`}>
                  <div className={`px-4 py-2 rounded-2xl text-sm max-w-[85%] shadow-sm ${m.sender === "You" ? "bg-blue-600 rounded-tr-none" : "bg-slate-800 rounded-tl-none border border-slate-700"}`}>
                    {m.text}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 mx-1">{m.time}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendMessage} className="p-4 bg-slate-950/50 flex gap-2">
              <input value={chatInput} disabled={!selectedUser} onChange={e => setChatInput(e.target.value)} placeholder="Type your message..." className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all" />
              <button type="submit" disabled={!selectedUser} className="bg-blue-600 px-5 py-2 rounded-xl font-bold hover:bg-blue-500 disabled:opacity-20 transition-all">Send</button>
            </form>
          </div>
        </main>
      </div>

      {/* Incoming Call Dialog */}
      {incomingCall && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-6">
          <div className="bg-slate-900 p-10 rounded-3xl text-center border border-slate-800 shadow-2xl max-w-sm w-full">
            <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-6 animate-pulse">📞</div>
            <p className="text-2xl font-bold mb-2">{incomingCall.callerName}</p>
            <p className="text-slate-400 mb-8">is requesting a video call...</p>
            <div className="flex gap-4">
              <button onClick={acceptCall} className="flex-1 bg-emerald-600 py-3 rounded-2xl font-bold text-lg hover:bg-emerald-500 shadow-lg shadow-emerald-900/20 transition-all">Accept</button>
              <button onClick={() => setIncomingCall(null)} className="flex-1 bg-rose-600 py-3 rounded-2xl font-bold text-lg hover:bg-rose-500 transition-all">Decline</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;