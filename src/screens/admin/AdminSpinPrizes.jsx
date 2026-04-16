import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../services/firebase';
import toast from 'react-hot-toast';

export default function AdminSpinPrizes() {
  const [prizes, setPrizes] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});

  const fetchPrizes = async () => {
    try {
      const snap = await getDocs(collection(db, 'spinPrizes'));
      setPrizes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Failed to fetch spin prizes", error);
    }
  };

  useEffect(() => {
    fetchPrizes();
  }, []);

  const totalWeight = prizes.reduce((sum, p) => sum + p.probabilityWeight, 0);

  const handleSave = async () => {
    const functions = getFunctions();
    const updateSpinPrize = httpsCallable(functions, 'updateSpinPrize');
    try {
      await updateSpinPrize({ prizeId: editing, updates: editForm });
      toast.success('Prize updated');
      setEditing(null);
      fetchPrizes(); // Refresh after save
    } catch (error) {
      toast.error('Update failed');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Spin Wheel Configuration</h1>

      <div className="grid gap-4">
        {prizes.map(p => {
          const isEditing = editing === p.id;
          const probPct = ((p.probabilityWeight / totalWeight) * 100).toFixed(1);

          return (
            <div key={p.id} className="card p-4 border border-white/10">
              {isEditing ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
                  <div>
                    <label className="text-xs text-white/50">Label</label>
                    <input type="text" value={editForm.label} onChange={e => setEditForm({...editForm, label: e.target.value})} className="input-field bg-white/5 p-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-white/50">Weight (Probability)</label>
                    <input type="number" value={editForm.probabilityWeight} onChange={e => setEditForm({...editForm, probabilityWeight: Number(e.target.value)})} className="input-field bg-white/5 p-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-white/50">Active</label>
                    <select value={editForm.isActive} onChange={e => setEditForm({...editForm, isActive: e.target.value === 'true'})} className="input-field bg-white/5 p-2 text-sm">
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSave} className="flex-1 bg-green-600 text-white rounded font-bold py-2">Save</button>
                    <button onClick={() => setEditing(null)} className="flex-1 bg-white/10 text-white rounded font-bold py-2">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-bold text-lg">{p.label}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${p.isActive ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>{p.isActive ? 'Active' : 'Disabled'}</span>
                      <span className="text-xs bg-white/10 px-2 py-0.5 rounded text-white/60">{p.prizeType}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-full max-w-[200px] h-2 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${probPct}%` }}></div>
                      </div>
                      <span className="text-xs text-white/60">{probPct}% chance (Weight: {p.probabilityWeight})</span>
                    </div>
                  </div>
                  <button onClick={() => { setEditing(p.id); setEditForm(p); }} className="px-4 py-2 bg-white/10 rounded font-bold hover:bg-white/20">
                    Edit
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}