import { useEffect, useState, useCallback } from 'react';
import { getTechnicians, updateTechnician } from '@/services/technicianService';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil } from 'lucide-react';
import type { User } from '@/types/database';
import { createTechnician } from '@/services/technicianService';
import { describeDbError } from '@/lib/dbErrors';
import { toast } from 'sonner';

export function TechnicianManagement() {
  const [technicians, setTechnicians] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingTech, setEditingTech] = useState<User | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getTechnicians();
      setTechnicians(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (creating) return;
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Name and email are required');
      return;
    }

    setCreating(true);
    try {
      // The server creates the login and the profile together and returns a
      // one-time temporary password. Nothing is hardcoded in the client.
      const result = await createTechnician({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
      });

      setTemporaryPassword(result.temporary_password ?? null);
      setForm({ name: '', email: '', phone: '' });
      toast.success('Technician created');
      load();
    } catch (err) {
      toast.error(describeDbError(err, err instanceof Error ? err.message : 'Failed to create technician'));
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = (tech: User) => {
    setEditingTech(tech);
    setForm({ name: tech.name, email: tech.email, phone: tech.phone || '' });
    setEditDialogOpen(true);
  };

  const handleUpdate = async () => {
    if (!editingTech) return;
    try {
      await updateTechnician(editingTech.id, {
        name: form.name,
        phone: form.phone,
      });
      toast.success('Technician updated');
      setEditDialogOpen(false);
      load();
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleToggleActive = async (tech: User) => {
    try {
      await updateTechnician(tech.id, { active: !tech.active });
      load();
    } catch {
      toast.error('Failed to update status');
    }
  };

  if (loading) {
    return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Technician Management</h1>
        <Dialog
          open={createDialogOpen}
          onOpenChange={(open) => {
            setCreateDialogOpen(open);
            if (!open) setTemporaryPassword(null);
          }}
        >
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" />
            Add Technician
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Technician</DialogTitle>
            </DialogHeader>
            {temporaryPassword && (
              <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
                <p className="text-sm font-medium">Technician created</p>
                <p className="text-xs text-muted-foreground">
                  Share this temporary password securely. It is shown only once and must be changed at first sign-in.
                </p>
                <code className="block break-all rounded bg-background p-2 text-sm">{temporaryPassword}</code>
              </div>
            )}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <Button onClick={handleCreate} className="w-full" disabled={creating}>
                {creating ? 'Creating...' : 'Create Technician'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {technicians.map((tech) => (
                <TableRow key={tech.id}>
                  <TableCell className="font-medium">{tech.name}</TableCell>
                  <TableCell>{tech.email}</TableCell>
                  <TableCell>{tech.phone || 'N/A'}</TableCell>
                  <TableCell>
                    <Badge variant={tech.active ? 'default' : 'secondary'}>
                      {tech.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(tech)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Switch
                        checked={tech.active}
                        onCheckedChange={() => handleToggleActive(tech)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Technician</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={form.email} disabled />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <Button onClick={handleUpdate} className="w-full">
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
