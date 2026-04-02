import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Cpu, Users, Zap, Wallet } from 'lucide-react';

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <LayoutDashboard size={20} />
        <span>Dashboard</span>
      </NavLink>
      <NavLink to="/machines" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Cpu size={20} />
        <span>Machines</span>
      </NavLink>
      <NavLink to="/referrals" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Users size={20} />
        <span>Referrals</span>
      </NavLink>
      <NavLink to="/spin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Zap size={20} />
        <span>Spin</span>
      </NavLink>
      <NavLink to="/wallet" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Wallet size={20} />
        <span>Wallet</span>
      </NavLink>
    </nav>
  );
}