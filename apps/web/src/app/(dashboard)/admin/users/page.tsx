'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FileDown,
  FileSpreadsheet,
  KeyRound,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { createClient } from '@/core/supabase/client';
import {
  CUSTOM_ROLE_SELECT,
  DEPARTMENT_SELECT,
  PROFILE_SELECT,
} from '@/core/supabase/selects';
import { useDashboardAuth } from '@/core/DashboardContext';
import {
  defaultModulePermission,
  hasCoreAction,
  hasModulePermission,
  MODULE_PERMISSION_DEFS,
  ROLE_LABELS,
} from '@/core/permissions';
import {
  exportExcelXml,
  exportPrintablePdf,
  ReportCell,
} from '@/core/utils/report-export';
import {
  ApprovalStatus,
  CoreActionKey,
  Department,
  ModulePermissionKey,
  ModulePermissionSet,
  Profile,
  UserPermissionsJson,
  UserRole,
} from '@/types/database';
import {
  ALL_ROLES,
  APPROVAL_LABELS,
  buildModuleMapForRole,
  CORE_ACTION_DEFS,
  CUSTOM_PREFIX,
  CustomRole,
  EDITABLE_MODULES,
  EditableModuleKey,
  getInitials,
  OTHER_VALUE,
  UserRow,
} from '@/features/admin/user-helpers';
import {
  CustomRolesModal,
  EditUserModal,
  UserPermissionsModal,
} from '@/features/admin/components/UserModals';

export default function AdminUsersPage() {
  const { refreshProfile } = useDashboardAuth();
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});
  const [depts, setDepts] = useState<Department[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filtreler
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ApprovalStatus>('all');

  // Bekleyen kullanıcı satır içi seçim durumları
  const [pendingRoleSel, setPendingRoleSel] = useState<Record<string, string>>({});
  const [pendingDeptSel, setPendingDeptSel] = useState<Record<string, string>>({});

  // Yeni Personel Ekleme Formu
  const [showNewForm, setShowNewForm] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRoleSelect, setNewRoleSelect] = useState<string>('technician');
  const [customRoleText, setCustomRoleText] = useState('');
  const [newDeptSelect, setNewDeptSelect] = useState<string>('');
  const [customDeptText, setCustomDeptText] = useState('');
  const [creating, setCreating] = useState(false);

  // Tam Personel Düzenleme & Şifre Modalı
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRoleSelect, setEditRoleSelect] = useState<string>('employee');
  const [editCustomRoleText, setEditCustomRoleText] = useState('');
  const [editDeptSelect, setEditDeptSelect] = useState('');
  const [editCustomDeptText, setEditCustomDeptText] = useState('');
  const [editApprovalStatus, setEditApprovalStatus] = useState<ApprovalStatus>('approved');
  const [savingEdit, setSavingEdit] = useState(false);

  // Merkezi Modül & İşlem Yetkileri Modalı
  const [permTarget, setPermTarget] = useState<UserRow | null>(null);
  const [permModules, setPermModules] = useState<
    Record<EditableModuleKey, Record<ModulePermissionKey, boolean>>
  >(() => buildModuleMapForRole('technician'));
  const [permCoreActions, setPermCoreActions] = useState<CoreActionKey[]>([]);
  const [permResetDefaults, setPermResetDefaults] = useState(false);
  const [savingPerm, setSavingPerm] = useState(false);

  // Özel Rol Yönetimi Modalı
  const [showRolesModal, setShowRolesModal] = useState(false);
  const [newCustomRoleName, setNewCustomRoleName] = useState('');
  const [newCustomRoleBase, setNewCustomRoleBase] = useState<UserRole>('technician');
  const [savingRole, setSavingRole] = useState(false);

  const isAdmin = currentProfile?.role === 'system_admin';
  const canManageUsers =
    isAdmin || hasCoreAction(currentProfile, 'manage_users');
  const canViewPanel =
    canManageUsers ||
    currentProfile?.role === 'technical_manager' ||
    currentProfile?.role === 'team_lead';

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let me: Profile | null = null;
      if (user) {
        const { data: meData } = await supabase
          .from('profiles')
          .select(PROFILE_SELECT)
          .eq('id', user.id)
          .single();
        me = (meData as Profile) ?? null;
        setCurrentProfile(me);
      }

      const [pRes, dRes, crRes] = await Promise.all([
        supabase
          .from('profiles')
          .select(`${PROFILE_SELECT}, departments(name)`)
          .order('created_at', { ascending: false }),
        supabase
          .from('departments')
          .select(DEPARTMENT_SELECT)
          .eq('is_active', true)
          .order('name'),
        supabase.from('custom_roles').select(CUSTOM_ROLE_SELECT).order('name'),
      ]);

      if (pRes.error) throw pRes.error;
      setRows((pRes.data as unknown as UserRow[]) ?? []);
      setDepts((dRes.data as Department[]) ?? []);
      setCustomRoles((crRes.data as CustomRole[]) ?? []);

      const meCanManage =
        me?.role === 'system_admin' || hasCoreAction(me, 'manage_users');
      if (meCanManage) {
        const { data: emails } = await supabase.rpc('rpc_admin_get_user_emails');
        if (Array.isArray(emails)) {
          const map: Record<string, string> = {};
          for (const item of emails as { id: string; email: string }[]) {
            map[item.id] = item.email;
          }
          setEmailMap(map);
        }
      }
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Personel listesi alınamadı.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const roleOptions = useMemo(
    () => ALL_ROLES.filter((r) => r !== 'system_admin' || isAdmin),
    [isAdmin]
  );

  const counts = useMemo(() => {
    let approved = 0;
    let pending = 0;
    let inactive = 0;
    let rejected = 0;
    let disabled = 0;

    for (const r of rows) {
      if (r.approval_status === 'approved') approved++;
      else if (r.approval_status === 'pending') pending++;
      else if (r.approval_status === 'rejected') {
        rejected++;
        inactive++;
      } else if (r.approval_status === 'disabled') {
        disabled++;
        inactive++;
      }
    }
    return {
      total: rows.length,
      approved,
      pending,
      rejected,
      disabled,
      inactive,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.approval_status !== statusFilter) return false;
      if (!q) return true;
      const roleLabel = (r.custom_role || ROLE_LABELS[r.role] || r.role).toLowerCase();
      const deptName = (r.departments?.name || '').toLowerCase();
      const email = (emailMap[r.id] || '').toLowerCase();
      return (
        r.full_name.toLowerCase().includes(q) ||
        (r.phone || '').toLowerCase().includes(q) ||
        email.includes(q) ||
        roleLabel.includes(q) ||
        deptName.includes(q)
      );
    });
  }, [rows, statusFilter, search, emailMap]);

  async function resolveDepartmentId(
    selectedVal: string,
    manualName: string
  ): Promise<string | null> {
    if (selectedVal !== OTHER_VALUE) {
      return selectedVal || null;
    }
    const clean = manualName.trim();
    if (!clean) return null;

    const existing = depts.find((d) => d.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing.id;

    const supabase = createClient();
    const { data, error } = await supabase
      .from('departments')
      .insert({ name: clean, is_active: true })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error('Yeni departman eklenemedi: ' + (error?.message || 'Bilinmeyen hata'));
    }
    return (data as { id: string }).id;
  }

  function decodeRoleSelection(
    selected: string,
    manualText: string,
    fallbackBase: UserRole = 'technician'
  ): { enumRole: UserRole; customRoleVal: string | null } {
    if (selected === OTHER_VALUE) {
      return {
        enumRole: fallbackBase === 'system_admin' ? 'technician' : fallbackBase,
        customRoleVal: manualText.trim() || null,
      };
    }
    if (selected.startsWith(CUSTOM_PREFIX)) {
      const crId = selected.slice(CUSTOM_PREFIX.length);
      const found = customRoles.find((c) => c.id === crId);
      return {
        enumRole: found?.base_role || 'technician',
        customRoleVal: found?.name || null,
      };
    }
    return {
      enumRole: selected as UserRole,
      customRoleVal: null,
    };
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newFullName.trim()) {
      setMsg({ type: 'err', text: 'Lütfen Ad Soyad alanını giriniz.' });
      return;
    }
    if (newRoleSelect === OTHER_VALUE && !customRoleText.trim()) {
      setMsg({ type: 'err', text: 'Lütfen manuel rol / unvan adını yazınız.' });
      return;
    }
    if (newDeptSelect === OTHER_VALUE && !customDeptText.trim()) {
      setMsg({ type: 'err', text: 'Lütfen manuel departman adını yazınız.' });
      return;
    }
    if (newPassword && newPassword.length < 6) {
      setMsg({ type: 'err', text: 'Şifre girildiyse en az 6 karakter olmalıdır.' });
      return;
    }

    setCreating(true);
    setMsg(null);
    try {
      const targetDeptId = await resolveDepartmentId(newDeptSelect, customDeptText);
      const { enumRole, customRoleVal } = decodeRoleSelection(newRoleSelect, customRoleText);
      const passwordToUse = newPassword || '123456';

      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_admin_create_user', {
        p_full_name: newFullName.trim(),
        p_phone: newPhone.trim() || null,
        p_email: newEmail.trim() || null,
        p_password: passwordToUse,
        p_role: enumRole,
        p_department_id: targetDeptId,
        p_custom_role: customRoleVal,
      });

      if (error) throw error;

      setMsg({
        type: 'ok',
        text: `${newFullName.trim()} (${customRoleVal || ROLE_LABELS[enumRole]}) eklendi ve onaylandı. Giriş şifresi: ${passwordToUse}`,
      });
      setShowNewForm(false);
      setNewFullName('');
      setNewPhone('');
      setNewEmail('');
      setNewPassword('');
      setNewRoleSelect('technician');
      setCustomRoleText('');
      setNewDeptSelect('');
      setCustomDeptText('');
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Personel oluşturulamadı.',
      });
    } finally {
      setCreating(false);
    }
  }

  async function approvePending(r: UserRow) {
    const rawRole = pendingRoleSel[r.id] || r.role || 'employee';
    const { enumRole, customRoleVal } =
      rawRole === r.role && !pendingRoleSel[r.id] && r.custom_role
        ? { enumRole: r.role, customRoleVal: r.custom_role }
        : decodeRoleSelection(rawRole, '', r.role || 'employee');
    const deptId =
      pendingDeptSel[r.id] !== undefined
        ? pendingDeptSel[r.id] || null
        : r.department_id || null;

    setBusyId(r.id);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_approve_user', {
        p_user_id: r.id,
        p_role: enumRole,
        p_department_id: deptId,
        p_custom_role: customRoleVal,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: `${r.full_name} onaylandı.` });
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Onay işlemi başarısız oldu.',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function updateApprovalStatus(r: UserRow, nextStatus: ApprovalStatus, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(r.id);
    setMsg(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_set_user_approval_status', {
        p_user_id: r.id,
        p_status: nextStatus,
      });
      if (error) throw error;
      setMsg({
        type: 'ok',
        text: `${r.full_name} durumu "${APPROVAL_LABELS[nextStatus]}" olarak güncellendi.`,
      });
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Durum güncellenemedi.',
      });
    } finally {
      setBusyId(null);
    }
  }

  function openEditModal(r: UserRow) {
    setEditTarget(r);
    setEditFullName(r.full_name);
    setEditPhone(r.phone || '');
    setEditEmail(emailMap[r.id] || '');
    setEditPassword('');
    setEditApprovalStatus(r.approval_status);
    setEditDeptSelect(r.department_id || '');
    setEditCustomDeptText('');

    if (r.custom_role) {
      const matched = customRoles.find(
        (cr) => cr.name.toLowerCase() === r.custom_role!.toLowerCase()
      );
      if (matched) {
        setEditRoleSelect(CUSTOM_PREFIX + matched.id);
        setEditCustomRoleText('');
      } else {
        setEditRoleSelect(OTHER_VALUE);
        setEditCustomRoleText(r.custom_role);
      }
    } else {
      setEditRoleSelect(r.role);
      setEditCustomRoleText('');
    }
  }

  async function handleSaveFullEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    if (!editFullName.trim()) {
      setMsg({ type: 'err', text: 'Ad Soyad boş bırakılamaz.' });
      return;
    }
    if (editRoleSelect === OTHER_VALUE && !editCustomRoleText.trim()) {
      setMsg({ type: 'err', text: 'Lütfen manuel rol adını yazınız.' });
      return;
    }
    if (editDeptSelect === OTHER_VALUE && !editCustomDeptText.trim()) {
      setMsg({ type: 'err', text: 'Lütfen manuel departman adını yazınız.' });
      return;
    }
    if (editPassword && editPassword.length < 6) {
      setMsg({ type: 'err', text: 'Yeni şifre en az 6 karakter olmalıdır.' });
      return;
    }

    setSavingEdit(true);
    setMsg(null);
    try {
      const targetDeptId = await resolveDepartmentId(editDeptSelect, editCustomDeptText);
      const { enumRole, customRoleVal } = decodeRoleSelection(
        editRoleSelect,
        editCustomRoleText,
        editTarget.role
      );

      const supabase = createClient();
      const { error } = await supabase.rpc('rpc_admin_update_user', {
        p_user_id: editTarget.id,
        p_full_name: editFullName.trim(),
        p_phone: editPhone.trim() || null,
        p_email: editEmail.trim() || null,
        p_new_password: editPassword || null,
        p_role: enumRole,
        p_custom_role: customRoleVal,
        p_department_id: targetDeptId,
        p_approval_status: editApprovalStatus,
      });

      if (error) throw error;

      setMsg({
        type: 'ok',
        text: `${editFullName.trim()} bilgileri güncellendi${
          editPassword ? ' ve yeni şifre tanımlandı' : ''
        }.`,
      });
      const editedSelf = editTarget.id === currentProfile?.id;
      setEditTarget(null);
      await loadAll();
      if (editedSelf) {
        await refreshProfile();
      }
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Güncelleme başarısız oldu.',
      });
    } finally {
      setSavingEdit(false);
    }
  }

  function openPermModal(r: UserRow) {
    setPermTarget(r);
    setPermModules(buildModuleMapForRole(r.role, r.permissions));
    setPermCoreActions(r.permissions?.core_actions ?? []);
    setPermResetDefaults(false);
  }

  function toggleModulePerm(modKey: EditableModuleKey, permKey: ModulePermissionKey) {
    setPermResetDefaults(false);
    setPermModules((prev) => {
      const currentMod = { ...prev[modKey] };
      const nextVal = !currentMod[permKey];
      currentMod[permKey] = nextVal;
      if (permKey === 'enabled' && !nextVal) {
        for (const def of MODULE_PERMISSION_DEFS) {
          currentMod[def.key] = false;
        }
      } else if (permKey !== 'enabled' && nextVal) {
        currentMod.enabled = true;
      }
      return { ...prev, [modKey]: currentMod };
    });
  }

  function setAllModulePerms(modKey: EditableModuleKey, enabled: boolean) {
    setPermResetDefaults(false);
    setPermModules((prev) => {
      const nextMod = { ...prev[modKey] };
      for (const def of MODULE_PERMISSION_DEFS) {
        nextMod[def.key] = enabled;
      }
      return { ...prev, [modKey]: nextMod };
    });
  }

  function toggleCoreAction(key: CoreActionKey) {
    if (key === 'manage_modules' && !isAdmin) return;
    setPermCoreActions((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  }

  function resetPermToRoleDefault() {
    if (!permTarget) return;
    setPermModules(buildModuleMapForRole(permTarget.role));
    setPermCoreActions(
      permTarget.role === 'system_admin' ? CORE_ACTION_DEFS.map((a) => a.key) : []
    );
    setPermResetDefaults(true);
  }

  async function savePermissions() {
    if (!permTarget) return;
    setSavingPerm(true);
    setMsg(null);
    try {
      const supabase = createClient();
      const modulesPayload: Record<string, ModulePermissionSet> = {};
      if (!permResetDefaults) {
        for (const mod of EDITABLE_MODULES) {
          const currentMap = permModules[mod.key];
          const differs = MODULE_PERMISSION_DEFS.some(
            (def) =>
              Boolean(currentMap[def.key]) !==
              defaultModulePermission(permTarget.role, mod.key, def.key)
          );
          if (differs) {
            modulesPayload[mod.key] = { ...currentMap };
          }
        }
      }

      const payload: UserPermissionsJson = {};
      if (Object.keys(modulesPayload).length > 0) {
        payload.modules = modulesPayload;
      }
      const allowedCoreActions = isAdmin
        ? permCoreActions
        : permCoreActions.filter((k) => k !== 'manage_modules');
      if (allowedCoreActions.length > 0) {
        payload.core_actions = allowedCoreActions;
      }

      const { error } = await supabase.rpc('rpc_update_user_permissions', {
        p_user_id: permTarget.id,
        p_permissions: payload,
      });
      if (error) throw error;
      setMsg({
        type: 'ok',
        text: `${permTarget.full_name} için modül ve çekirdek yetkileri güncellendi.`,
      });
      setPermTarget(null);
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Yetkiler kaydedilemedi.',
      });
    } finally {
      setSavingPerm(false);
    }
  }

  async function handleAddCustomRole(e: React.FormEvent) {
    e.preventDefault();
    if (!newCustomRoleName.trim()) return;
    setSavingRole(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('custom_roles').insert({
        name: newCustomRoleName.trim(),
        base_role: newCustomRoleBase,
      });
      if (error) throw error;
      setMsg({ type: 'ok', text: `"${newCustomRoleName.trim()}" özel rolü eklendi.` });
      setNewCustomRoleName('');
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Özel rol eklenemedi.',
      });
    } finally {
      setSavingRole(false);
    }
  }

  async function handleDeleteCustomRole(cr: CustomRole) {
    if (!window.confirm(`"${cr.name}" özel rolünü kaldırmak istiyor musunuz?`)) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.from('custom_roles').delete().eq('id', cr.id);
      if (error) throw error;
      setMsg({ type: 'ok', text: `"${cr.name}" rolü kaldırıldı.` });
      await loadAll();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Özel rol silinemedi.',
      });
    }
  }

  function buildReportData() {
    const headers = [
      'Ad Soyad',
      'E-Posta',
      'Telefon',
      'Durum',
      'Rol / Ünvan',
      'Departman',
      'Enerji Modülü',
      'İş Takip Modülü',
      'Çekirdek Yetkiler',
      'Kayıt Tarihi',
    ];
    const reportRows: ReportCell[][] = filtered.map((r) => {
      const hasEnergy = hasModulePermission(r, 'energy', 'enabled');
      const hasWork = hasModulePermission(r, 'work_tracking', 'enabled');
      const coreLabels =
        r.role === 'system_admin'
          ? 'Tam Yönetici'
          : (r.permissions?.core_actions ?? [])
              .map((k) => CORE_ACTION_DEFS.find((d) => d.key === k)?.label ?? k)
              .join(', ') || '-';
      return [
        r.full_name,
        emailMap[r.id] || '-',
        r.phone || '-',
        APPROVAL_LABELS[r.approval_status],
        r.custom_role || ROLE_LABELS[r.role],
        r.departments?.name || '-',
        hasEnergy ? 'Açık' : 'Kapalı',
        hasWork ? 'Açık' : 'Kapalı',
        coreLabels,
        new Intl.DateTimeFormat('tr-TR').format(new Date(r.created_at)),
      ];
    });
    return { headers, reportRows };
  }

  function handleExportExcel() {
    const { headers, reportRows } = buildReportData();
    exportExcelXml({
      fileName: `avm_tech_personel_listesi_${new Date().toISOString().slice(0, 10)}.xls`,
      sheetName: 'Personel',
      title: 'DOWNTOWN TEKNİK · Personel & Merkezi Yetkilendirme Listesi',
      subtitle: `Durum Filtresi: ${
        statusFilter === 'all' ? 'Tümü' : APPROVAL_LABELS[statusFilter]
      } · Toplam ${filtered.length} personel`,
      headers,
      rows: reportRows,
    });
  }

  function handleExportPdf() {
    const { headers, reportRows } = buildReportData();
    exportPrintablePdf({
      title: 'Personel & Merkezi Yetkilendirme Raporu',
      subtitle: `Filtre: ${
        statusFilter === 'all' ? 'Tüm Personeller' : APPROVAL_LABELS[statusFilter]
      } · ${filtered.length} kayıt listeleniyor`,
      kpis: [
        { label: 'Toplam Personel', value: String(counts.total), tone: 'navy' },
        { label: 'Onaylı / Aktif', value: String(counts.approved), tone: 'green' },
        { label: 'Onay Bekleyen', value: String(counts.pending), tone: 'slate' },
        { label: 'Pasif / Reddedilen', value: String(counts.inactive), tone: 'red' },
      ],
      headers,
      rows: reportRows,
    });
  }

  if (!loading && currentProfile && !canViewPanel) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Bu sayfayı görüntülemek için yönetim veya personel yönetim yetkiniz bulunmuyor.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Üst Başlık & Aksiyonlar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            ÇEKİRDEK YÖNETİM
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold text-slate-900">
            Personel & Merkezi Yetkilendirme
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Bekleyen personel onayları, özel roller, şifre sıfırlama ve her modül için 8 bağımsız
            izin yönetimi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowRolesModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
            >
              <Shield className="h-3.5 w-3.5 text-turquoise" />
              Rolleri Yönet
            </button>
          )}

          {canManageUsers && (
            <button
              type="button"
              onClick={() => setShowNewForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              Yeni Personel Ekle
            </button>
          )}

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-40"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            Excel İndir (.xls)
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-800 transition hover:bg-rose-100 disabled:opacity-40"
          >
            <FileDown className="h-3.5 w-3.5 text-rose-700" />
            PDF Rapor İndir
          </button>
        </div>
      </div>

      {/* Özet KPI Kartları */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Toplam Personel
            </div>
            <div className="mt-1 text-2xl font-extrabold text-navy">{counts.total}</div>
            <div className="mt-0.5 text-xs text-slate-500">Kayıtlı kullanıcı</div>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-soft text-navy">
            <Users className="h-5 w-5" />
          </span>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Onaylı / Aktif
            </div>
            <div className="mt-1 text-2xl font-extrabold text-emerald-600">{counts.approved}</div>
            <div className="mt-0.5 text-xs text-slate-500">Sisteme erişimi açık</div>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
            <UserCheck className="h-5 w-5" />
          </span>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Onay Bekleyen
            </div>
            <div className="mt-1 text-2xl font-extrabold text-amber-600">{counts.pending}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {counts.pending > 0 ? 'Yönetici onayı bekliyor' : 'Bekleyen talep yok'}
            </div>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <Clock className="h-5 w-5" />
          </span>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Pasif / Reddedilen
            </div>
            <div className="mt-1 text-2xl font-extrabold text-slate-700">{counts.inactive}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {counts.disabled} pasif · {counts.rejected} reddedildi
            </div>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
            <UserX className="h-5 w-5" />
          </span>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-xl border p-3 text-sm font-medium ${
            msg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Yeni Personel Ekleme Formu */}
      {canManageUsers && showNewForm && (
        <form
          onSubmit={handleCreateUser}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-extrabold text-navy">Yeni Personel Ekle</h2>
              <p className="text-xs text-slate-500">
                Eklenen personel doğrudan onaylı olarak aktifleşir ve şifresiyle hemen giriş
                yapabilir.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewForm(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Ad Soyad *</label>
              <input
                type="text"
                required
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="Örn: Ahmet Yılmaz"
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Telefon</label>
              <input
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="05XX XXX XX XX"
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                E-Posta (İsteğe Bağlı)
              </label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Boş bırakılırsa otomatik oluşturulur"
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                Geçici Şifre (Varsayılan: 123456)
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="En az 6 karakter veya boş bırakın"
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm focus:border-navy focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Rol / Ünvan</label>
              <select
                value={newRoleSelect}
                onChange={(e) => {
                  setNewRoleSelect(e.target.value);
                  if (e.target.value !== OTHER_VALUE) setCustomRoleText('');
                }}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium focus:border-navy focus:outline-none"
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
                {customRoles.map((cr) => (
                  <option key={cr.id} value={CUSTOM_PREFIX + cr.id}>
                    {cr.name} ({ROLE_LABELS[cr.base_role]})
                  </option>
                ))}
                <option value={OTHER_VALUE}>Diğer (Manuel Giriş)</option>
              </select>
              {newRoleSelect === OTHER_VALUE && (
                <input
                  type="text"
                  required
                  value={customRoleText}
                  onChange={(e) => setCustomRoleText(e.target.value)}
                  placeholder="Rol / Ünvan yazınız (örn: Vardiya Amiri)"
                  className="mt-2 w-full rounded-xl border border-navy/40 bg-navy-soft/40 px-3 py-2 text-sm focus:border-navy focus:outline-none"
                />
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Departman</label>
              <select
                value={newDeptSelect}
                onChange={(e) => {
                  setNewDeptSelect(e.target.value);
                  if (e.target.value !== OTHER_VALUE) setCustomDeptText('');
                }}
                className="w-full rounded-xl border border-slate-200 bg-canvas px-3 py-2 text-sm font-medium focus:border-navy focus:outline-none"
              >
                <option value="">Departman seçiniz...</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
                <option value={OTHER_VALUE}>Diğer (Manuel Giriş)</option>
              </select>
              {newDeptSelect === OTHER_VALUE && (
                <input
                  type="text"
                  required
                  value={customDeptText}
                  onChange={(e) => setCustomDeptText(e.target.value)}
                  placeholder="Yeni departman adını yazınız..."
                  className="mt-2 w-full rounded-xl border border-navy/40 bg-navy-soft/40 px-3 py-2 text-sm focus:border-navy focus:outline-none"
                />
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowNewForm(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={creating}
              className="rounded-xl bg-navy px-5 py-2 text-xs font-bold text-white hover:bg-navy-hover disabled:opacity-50"
            >
              {creating ? 'Ekleniyor...' : 'Personeli Ekle ve Onayla'}
            </button>
          </div>
        </form>
      )}

      {/* Filtre Hapları & Arama */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['all', `Tümü (${counts.total})`],
              ['pending', `Onay Bekleyen (${counts.pending})`],
              ['approved', `Onaylı (${counts.approved})`],
              ['disabled', `Pasif (${counts.disabled})`],
              ['rejected', `Reddedildi (${counts.rejected})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                statusFilter === key
                  ? 'bg-navy text-white shadow-sm'
                  : 'border border-slate-200 bg-canvas text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ad soyad, telefon, e-posta veya rol ara..."
            className="w-full rounded-xl border border-slate-200 bg-canvas py-1.5 pl-9 pr-3 text-sm text-slate-800 focus:border-navy focus:outline-none"
          />
        </div>
      </div>

      {/* Personel Tablosu */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-canvas text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Personel</th>
                <th className="px-4 py-3">Telefon</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">Rol / Ünvan</th>
                <th className="px-4 py-3">Departman</th>
                <th className="px-4 py-3">Modül Yetkileri</th>
                <th className="px-4 py-3">Kayıt</th>
                <th className="min-w-[260px] px-4 py-3 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => {
                const isSelf = r.id === currentProfile?.id;
                const userEmail = emailMap[r.id];
                const hasEnergy = hasModulePermission(r, 'energy', 'enabled');
                const hasWork = hasModulePermission(r, 'work_tracking', 'enabled');
                const coreCount =
                  r.role === 'system_admin'
                    ? CORE_ACTION_DEFS.length
                    : r.permissions?.core_actions?.length ?? 0;

                return (
                  <tr key={r.id} className="align-top hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-navy-soft text-xs font-extrabold text-navy">
                          {getInitials(r.full_name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-bold text-slate-900">
                            <span className="truncate">{r.full_name}</span>
                            {isSelf && (
                              <span className="rounded-full bg-turquoise-soft px-2 py-0.5 text-[10px] font-extrabold text-turquoise">
                                Siz
                              </span>
                            )}
                          </div>
                          {userEmail && (
                            <div className="truncate text-xs text-slate-400">{userEmail}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-slate-600">{r.phone || '-'}</td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                          r.approval_status === 'approved'
                            ? 'bg-emerald-100 text-emerald-700'
                            : r.approval_status === 'pending'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {APPROVAL_LABELS[r.approval_status]}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">
                        {r.custom_role || ROLE_LABELS[r.role]}
                      </div>
                      {r.custom_role && (
                        <div className="text-[11px] text-slate-400">
                          Temel: {ROLE_LABELS[r.role]}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-slate-600">{r.departments?.name || '-'}</td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.approval_status !== 'approved' ? (
                          <span className="text-xs text-slate-400">Pasif</span>
                        ) : (
                          <>
                            {hasEnergy && (
                              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                                Enerji Takip
                              </span>
                            )}
                            {hasWork && (
                              <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700">
                                İş Takip
                              </span>
                            )}
                            {coreCount > 0 && (
                              <span className="rounded-md bg-navy-soft px-2 py-0.5 text-[11px] font-bold text-navy">
                                +{coreCount} Çekirdek
                              </span>
                            )}
                            {!hasEnergy && !hasWork && coreCount === 0 && (
                              <span className="text-xs text-slate-400">Modül yok</span>
                            )}
                          </>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Intl.DateTimeFormat('tr-TR').format(new Date(r.created_at))}
                    </td>

                    <td className="px-4 py-3">
                      {!canManageUsers ? (
                        <div className="text-right text-xs text-slate-400">Salt Okunur</div>
                      ) : r.approval_status === 'pending' && !isSelf ? (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <select
                            value={pendingRoleSel[r.id] || r.role || 'employee'}
                            onChange={(e) =>
                              setPendingRoleSel((prev) => ({
                                ...prev,
                                [r.id]: e.target.value,
                              }))
                            }
                            className="rounded-lg border border-slate-200 bg-canvas px-2 py-1 text-xs font-medium"
                          >
                            {roleOptions.map((x) => (
                              <option key={x} value={x}>
                                {ROLE_LABELS[x]}
                              </option>
                            ))}
                            {customRoles.map((cr) => (
                              <option key={cr.id} value={CUSTOM_PREFIX + cr.id}>
                                {cr.name}
                              </option>
                            ))}
                          </select>

                          <select
                            value={
                              pendingDeptSel[r.id] !== undefined
                                ? pendingDeptSel[r.id]
                                : r.department_id || ''
                            }
                            onChange={(e) =>
                              setPendingDeptSel((prev) => ({
                                ...prev,
                                [r.id]: e.target.value,
                              }))
                            }
                            className="rounded-lg border border-slate-200 bg-canvas px-2 py-1 text-xs font-medium"
                          >
                            <option value="">Departman yok</option>
                            {depts.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => approvePending(r)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Onayla
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditModal(r)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-navy-soft/60 px-2.5 py-1 text-xs font-bold text-navy transition hover:bg-navy-soft"
                          >
                            <Pencil className="h-3 w-3" />
                            Düzenle
                          </button>

                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() =>
                              updateApprovalStatus(
                                r,
                                'rejected',
                                `"${r.full_name}" kaydını reddetmek istediğinize emin misiniz?`
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            Reddet
                          </button>
                        </div>
                      ) : !isAdmin && r.role === 'system_admin' ? (
                        <div className="text-right text-xs text-slate-400">Sistem Yöneticisi</div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(r)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-navy-soft/60 px-2.5 py-1 text-xs font-bold text-navy transition hover:bg-navy-soft"
                          >
                            <Pencil className="h-3 w-3" />
                            Düzenle / Şifre
                          </button>

                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() => openPermModal(r)}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 transition hover:bg-amber-100"
                            >
                              <Shield className="h-3 w-3" />
                              Yetkiler
                            </button>
                          )}

                          {!isSelf && (
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              onClick={() => {
                                const next =
                                  r.approval_status === 'approved' ? 'disabled' : 'approved';
                                const label =
                                  next === 'disabled'
                                    ? `"${r.full_name}" kullanıcısını pasife almak (sistem erişimini kapatmak) istiyor musunuz?`
                                    : `"${r.full_name}" kullanıcısını tekrar aktif etmek istiyor musunuz?`;
                                updateApprovalStatus(r, next, label);
                              }}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold transition disabled:opacity-50 ${
                                r.approval_status === 'approved'
                                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              }`}
                            >
                              {r.approval_status === 'approved' ? 'Pasife Al' : 'Aktif Et'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    {loading
                      ? 'Personel listesi yükleniyor...'
                      : 'Arama kriterine uygun personel kaydı bulunamadı.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alt Bilgi: Sistem Rolleri & 8 Bağımsız İzin Özeti */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-extrabold text-navy">Desteklenen Sistem Rolleri</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <span
                key={key}
                className="rounded-full border border-slate-200 bg-canvas px-3 py-1 text-xs font-semibold text-slate-700"
              >
                {label} <span className="text-slate-400">({key})</span>
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-extrabold text-navy">
            Modül Bazlı 8 Bağımsız İzin Anahtarı (RLS + RPC)
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MODULE_PERMISSION_DEFS.map((perm) => (
              <div
                key={perm.key}
                className="rounded-xl border border-slate-200 bg-canvas p-2.5 text-xs"
              >
                <div className="font-bold text-navy">{perm.label}</div>
                <div className="mt-0.5 font-mono text-[11px] text-slate-400">{perm.key}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <EditUserModal
        target={editTarget}
        currentProfileId={currentProfile?.id}
        depts={depts}
        roleOptions={roleOptions}
        customRoles={customRoles}
        editFullName={editFullName}
        setEditFullName={setEditFullName}
        editPhone={editPhone}
        setEditPhone={setEditPhone}
        editEmail={editEmail}
        setEditEmail={setEditEmail}
        editApprovalStatus={editApprovalStatus}
        setEditApprovalStatus={setEditApprovalStatus}
        editRoleSelect={editRoleSelect}
        setEditRoleSelect={setEditRoleSelect}
        editCustomRoleText={editCustomRoleText}
        setEditCustomRoleText={setEditCustomRoleText}
        editDeptSelect={editDeptSelect}
        setEditDeptSelect={setEditDeptSelect}
        editCustomDeptText={editCustomDeptText}
        setEditCustomDeptText={setEditCustomDeptText}
        editPassword={editPassword}
        setEditPassword={setEditPassword}
        savingEdit={savingEdit}
        onClose={() => setEditTarget(null)}
        onSubmit={handleSaveFullEdit}
      />

      {canManageUsers && (
        <UserPermissionsModal
          target={permTarget}
          isAdmin={isAdmin}
          permModules={permModules}
          permCoreActions={permCoreActions}
          savingPerm={savingPerm}
          onSetAllModulePerms={setAllModulePerms}
          onToggleModulePerm={toggleModulePerm}
          onToggleCoreAction={toggleCoreAction}
          onResetToDefault={resetPermToRoleDefault}
          onSave={savePermissions}
          onClose={() => setPermTarget(null)}
        />
      )}

      {isAdmin && (
        <CustomRolesModal
          open={showRolesModal}
          customRoles={customRoles}
          newCustomRoleName={newCustomRoleName}
          setNewCustomRoleName={setNewCustomRoleName}
          newCustomRoleBase={newCustomRoleBase}
          setNewCustomRoleBase={setNewCustomRoleBase}
          savingRole={savingRole}
          onAddRole={handleAddCustomRole}
          onDeleteRole={handleDeleteCustomRole}
          onClose={() => setShowRolesModal(false)}
        />
      )}
    </div>
  );
}
