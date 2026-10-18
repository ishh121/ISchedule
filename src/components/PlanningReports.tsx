import { BarChart3, DoorOpen, GraduationCap } from 'lucide-react';
import './planning.css';
import { facultyWorkloads, roomUtilization } from '../planning';
import type { CollegeData, ScheduleResult } from '../types';

export default function PlanningReports({ data, schedule }: { data: CollegeData; schedule: ScheduleResult | null }) {
  const workloads = facultyWorkloads(data, schedule?.sessions ?? []);
  const rooms = roomUtilization(data, schedule?.sessions ?? []);
  if (!schedule) return <section className="planning-reports card"><div className="planning-empty"><BarChart3 size={22} /><strong>Reports appear after a timetable is generated.</strong><span>Workload and room capacity use the placed sessions from the current schedule.</span></div></section>;
  return <section className="planning-reports">
    <div className="planning-report-grid">
      <section className="card report-card">
        <div className="card-heading"><div><h3>Faculty workload</h3><p>Teaching time against available teaching capacity.</p></div><GraduationCap size={18} className="muted-icon" /></div>
        <div className="report-list">{workloads.length ? workloads.map(workload => <div className="report-row" key={workload.facultyId}><div className="report-row-heading"><strong>{workload.facultyName}</strong><span>{workload.periods} / {workload.capacityPeriods} periods</span></div><div className="report-bar"><span style={{ width: `${Math.min(100, workload.utilization * 100)}%` }} /></div><small>{workload.hours.toFixed(1)} teaching hours / {workload.capacityHours.toFixed(1)} available hours · {Math.round(workload.utilization * 100)}% used</small></div>) : <p className="muted">No faculty records are available.</p>}</div>
      </section>
      <section className="card report-card">
        <div className="card-heading"><div><h3>Room utilization</h3><p>Occupied room time against the selected teaching days.</p></div><DoorOpen size={18} className="muted-icon" /></div>
        <div className="report-list">{rooms.length ? rooms.map(room => <div className="report-row" key={room.roomId}><div className="report-row-heading"><strong>{room.roomName}</strong><span>{room.occupiedPeriods} / {room.capacityPeriods} periods</span></div><div className="report-bar room"><span style={{ width: `${Math.min(100, room.utilization * 100)}%` }} /></div><small>{room.occupiedHours.toFixed(1)} occupied hours / {room.capacityHours.toFixed(1)} available hours · {Math.round(room.utilization * 100)}% used</small></div>) : <p className="muted">No rooms are available.</p>}</div>
      </section>
    </div>
  </section>;
}
