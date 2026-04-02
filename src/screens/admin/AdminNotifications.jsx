import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';

export default function AdminNotifications() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [segment, setSegment] = useState('all');
  const [loading, setLoading] = useState(false);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Send this notification to ${segment.replace('_', ' ')} users?`)) return;
    
    setLoading(true);
    const functions = getFunctions();
    const broadcastNotification = httpsCallable(functions, 'broadcastNotification');
    
    try {
      const res = await broadcastNotification({ title, body, segment });
      toast.success(`Sent to ${res.data.sent} devices`);
      setTitle('');
      setBody('');
    } catch (error) {
      toast.error(error.message || 'Failed to send');
    }
    setLoading(false);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Broadcast Notification</h1>

      <div className="card max-w-2xl p-6">
        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-1">Target Audience</label>
            <select value={segment} onChange={e => setSegment(e.target.value)} className="input-field bg-white/5">
              <option value="all">All Users</option>
              <option value="with_machines">Users with Active Machines</option>
              <option value="without_machines">Users without Machines</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm text-white/60 mb-1">Title</label>
            <input 
              type="text" 
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              placeholder="e.g., 🚀 Flash Sale!" 
              className="input-field bg-white/5" 
              required 
              maxLength={50}
            />
          </div>

          <div>
            <label className="block text-sm text-white/60 mb-1">Message Body</label>
            <textarea 
              value={body} 
              onChange={e => setBody(e.target.value)} 
              placeholder="Enter your message here..." 
              className="input-field bg-white/5 h-32 resize-none" 
              required 
              maxLength={150}
            />
            <p className="text-right text-xs text-white/40 mt-1">{body.length}/150</p>
          </div>

          <button type="submit" disabled={loading} className="w-full py-3 rounded-lg font-bold bg-blue-600 text-white mt-4 active:scale-95">
            {loading ? 'Sending...' : 'Send Broadcast'}
          </button>
        </form>
      </div>
    </div>
  );
}