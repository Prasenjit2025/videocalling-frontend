import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const socket: Socket = io("https://videocalling-backend-production.up.railway.app/", { 
  transports: ["websocket"] 
});

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
  const [chatHistory, setChatHistory] = useState<{ [key: string]: Message[] }>({});
  const [chatInput, setChatInput] = useState("");

  const [micActive, setMicActive] = useState(true);
  const [videoActive, setVideoActive] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    socket.on("login-success", () => setLoggedIn(true));
    socket.on("online-users", (list: User[]) => {
      setUsers(list.filter(u => u.id !== socket.id));
    });
    
    socket.on("incoming-call", (data) => setIncomingCall(data));

    socket.on("call-accepted", async ({ answer }) => {
      if (peerRef.current) {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        while (pendingCandidates.current.length > 0) {
          const c = pendingCandidates.current.shift();
          if (c) await peerRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
        }
      }
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      if (peerRef.current?.remoteDescription) {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
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
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
          localStreamRef.current = stream;
          if (localVideo.current) localVideo.current.srcObject = stream;
        })
        .catch(() => alert("Camera access required."));
    }
  }, [loggedIn]);

  // --- New Logout Functionality ---
  const handleLogout = () => {
    // 1. Stop all camera/mic tracks
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    
    // 2. Cleanup any active peer connection
    cleanupCall();

    // 3. Reset states
    setLoggedIn(false);
    setUsername("");
    setSelectedUser(null);
    setChatHistory({});
    
    // 4. Reload or Disconnect Socket (Socket will naturally cleanup on disconnect)
    window.location.reload(); 
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicActive(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoActive(videoTrack.enabled);
      }
    }
  };

  const createPeer = (targetId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });
    pc.ontrack = (e) => {
      if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0];
    };
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
    if (!incomingCall) return;
    const pc = createPeer(incomingCall.from);
    setSelectedUser({ id: incomingCall.from, username: incomingCall.callerName, busy: true });
    await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer-call", { to: incomingCall.from, answer });
    while (pendingCandidates.current.length > 0) {
      const c = pendingCandidates.current.shift();
      if (c) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
    }
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
    pendingCandidates.current = [];
  }

  if (!loggedIn) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-950 text-white p-4">
      <div className="bg-slate-900 p-8 rounded-3xl shadow-2xl w-full max-w-md border border-slate-800">
        <h2 className="text-4xl font-black mb-8 text-center bg-linear-to-r from-blue-500 to-indigo-400 bg-clip-text text-transparent">Connect</h2>
        <div className="space-y-4">
          <input className="w-full p-4 bg-slate-800 rounded-2xl border border-slate-700 outline-none" placeholder="Username" onChange={e => setUsername(e.target.value)} />
          <input className="w-full p-4 bg-slate-800 rounded-2xl border border-slate-700 outline-none" type="password" placeholder="Password" onChange={e => setPassword(e.target.value)} />
          <button className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl font-bold text-lg transition-all" onClick={() => socket.emit("login", { username, password })}>Sign In</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-slate-950 text-slate-100 overflow-hidden">
      
      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800">
        <h1 className="font-bold text-blue-400">GC</h1>
        <div className="flex gap-2">
            <button onClick={handleLogout} className="text-xs bg-rose-600/20 text-rose-500 px-3 py-1 rounded-lg border border-rose-500/30">Logout</button>
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 bg-slate-800 rounded-lg"> {isSidebarOpen ? "✕" : "☰"}</button>
        </div>
      </div>

      {/* Sidebar */}
      <div className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:relative z-40 w-72 h-full bg-slate-900 border-r border-slate-800 transition-transform flex flex-col`}>
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-bold">User</p>
            <h1 className="text-xl font-bold text-blue-400 truncate w-32">{username}</h1>
          </div>
          <button onClick={handleLogout} className="hidden lg:block p-2 hover:bg-rose-600/20 text-rose-500 rounded-xl transition-colors" title="Logout">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="text-[10px] text-slate-500 mb-4 font-black uppercase tracking-widest">Contacts</h2>
          {users.map(u => (
            <button key={u.id} onClick={() => { setSelectedUser(u); setIsSidebarOpen(false); }}
              className={`w-full text-left p-4 rounded-2xl mb-2 flex items-center justify-between transition-all ${selectedUser?.id === u.id ? 'bg-blue-600' : 'bg-slate-800 hover:bg-slate-700'}`}>
              <span className="font-medium truncate">{u.username}</span>
              {u.busy && <span className="text-[9px] bg-red-500 px-2 py-0.5 rounded-full uppercase">Busy</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 lg:h-20 border-b border-slate-800 flex items-center justify-between px-4 lg:px-8 bg-slate-950/80 backdrop-blur-md">
          <h2 className="text-sm lg:text-lg font-bold truncate">
            {selectedUser ? `Chat: ${selectedUser.username}` : "Select a contact"}
          </h2>
          {selectedUser && (
            <div className="flex gap-2">
              <button onClick={callUser} disabled={selectedUser.busy} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 px-4 py-2 rounded-xl text-xs font-bold">Call</button>
              <button onClick={() => { socket.emit("end-call", { to: selectedUser.id }); cleanupCall(); }} className="bg-rose-600 hover:bg-rose-500 px-4 py-2 rounded-xl text-xs font-bold">End</button>
            </div>
          )}
        </header>

        <main className="flex-1 flex flex-col lg:flex-row p-3 lg:p-6 gap-4 overflow-hidden">
          {/* Video Section */}
          <div className="flex-2 flex flex-col gap-4">
            <div className="relative flex-1 bg-slate-900 rounded-4xl border border-slate-800 overflow-hidden group">
              <video ref={remoteVideo} autoPlay playsInline className="w-full h-full object-cover" />
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-4">
                <button onClick={toggleMic} className={`p-4 rounded-full ${micActive ? 'bg-slate-800' : 'bg-rose-600'}`}>{micActive ? '🎤' : '🔇'}</button>
                <button onClick={toggleVideo} className={`p-4 rounded-full ${videoActive ? 'bg-slate-800' : 'bg-rose-600'}`}>{videoActive ? '📹' : '📵'}</button>
              </div>
            </div>
            <div className="h-32 lg:h-44 flex justify-end">
              <video ref={localVideo} autoPlay muted playsInline className="w-44 lg:w-64 rounded-2xl border border-slate-700 bg-black object-cover" />
            </div>
          </div>

          {/* Chat Panel */}
          <div className="flex-1 bg-slate-900 rounded-4xl border border-slate-800 flex flex-col overflow-hidden h-[35vh] lg:h-auto">
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {(selectedUser ? chatHistory[selectedUser.id] || [] : []).map((m, i) => (
                <div key={i} className={`flex flex-col ${m.sender === "You" ? "items-end" : "items-start"}`}>
                  <div className={`px-4 py-2 rounded-2xl text-[13px] ${m.sender === "You" ? "bg-blue-600" : "bg-slate-800"}`}>{m.text}</div>
                  <span className="text-[9px] text-slate-500 mt-1">{m.time}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendMessage} className="p-3 bg-slate-950/50 border-t border-slate-800 flex gap-2">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type..." className="flex-1 bg-slate-800 rounded-xl px-4 py-2 text-sm outline-none" />
              <button type="submit" className="bg-blue-600 px-4 rounded-xl font-bold">Send</button>
            </form>
          </div>
        </main>
      </div>

      {/* Incoming Call Modal */}
      {incomingCall && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl flex items-center justify-center z-100 p-6">
          <div className="bg-slate-900 p-8 rounded-[3rem] text-center border border-slate-800 max-w-sm w-full">
            <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-6 animate-pulse">📞</div>
            <h3 className="text-2xl font-bold mb-8">{incomingCall.callerName} is calling...</h3>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={acceptCall} className="bg-emerald-600 py-4 rounded-2xl font-bold">Accept</button>
              <button onClick={() => setIncomingCall(null)} className="bg-rose-600 py-4 rounded-2xl font-bold">Decline</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;