create or replace function public.load_tenant_config(p_slug text)
returns jsonb
language plpgsql
security definer
as $$
declare
  tenant_row public.tenants%rowtype;
  cred_row public.vf_credentials%rowtype;
  project_rows public.vf_projects%rowtype[];
begin
  select * into tenant_row from public.tenants where slug = p_slug;

  if tenant_row is null then
    return null;
  end if;

  select *
    into cred_row
    from public.vf_credentials
    where tenant_id = tenant_row.id
      and active = true
    order by created_at desc
    limit 1;

  if cred_row is null then
    return jsonb_build_object('tenant', tenant_row, 'credentials', null, 'projects', null);
  end if;

  select array_agg(project_row)
    into project_rows
    from (
      select *
      from public.vf_projects
      where tenant_id = tenant_row.id
        and active = true
      order by created_at asc
    ) as project_row;

  if project_rows is null then
    return jsonb_build_object('tenant', tenant_row, 'credentials', cred_row, 'projects', null);
  end if;

  return jsonb_build_object(
    'tenant', to_jsonb(tenant_row),
    'credentials', to_jsonb(cred_row),
    'projects', to_jsonb(project_rows)
  );
end;
$$;
