import importlib.util, json, pathlib, sqlite3, tempfile, unittest

spec=importlib.util.spec_from_file_location('handoff',pathlib.Path(__file__).with_name('handoff.py'))
handoff=importlib.util.module_from_spec(spec);spec.loader.exec_module(handoff)

class HandoffTest(unittest.TestCase):
 def test_roundtrip_is_namespaced_resumable_and_preserves_budget(self):
  with tempfile.TemporaryDirectory() as scratch:
   root=pathlib.Path(scratch);source=root/'source.sqlite';db=sqlite3.connect(source)
   for name in handoff.MIGRATIONS:db.executescript((handoff.ROOT/'migrations'/name).read_text())
   db.execute('CREATE TABLE private_unrelated(secret TEXT)');db.execute("INSERT INTO private_unrelated VALUES('do-not-export')")
   db.execute("INSERT INTO network_budgets VALUES('2026-10-29','official-client',123)")
   db.execute("INSERT INTO network_sync VALUES('scan','{}',123)");db.execute("INSERT INTO network_sync VALUES('wallet_rate','999',123)")
   for at in [1000,2000]:
    payload=json.dumps({'population':1,'cells':[{'count':1}]})
    db.execute('INSERT INTO network_snapshots VALUES(?,?,?,?,?)',(str(at),at,'1970-01-01',0,payload))
   db.commit();db.close()
   bundle=root/'bundle';handoff.export(source,bundle);manifest=handoff.verify(bundle)
   self.assertNotIn('private_unrelated',manifest['tables']);self.assertEqual(manifest['snapshots']['rows'],1)
   handoff.restore_test(bundle,root/'restored.sqlite')
   target=sqlite3.connect(root/'restored.sqlite')
   self.assertEqual(target.execute('SELECT value FROM network_sync').fetchall(),[('{}',)])
   target.execute('UPDATE network_budgets SET attempts=500');target.commit()
   for chunk in manifest['chunks']:target.executescript((bundle/chunk['file']).read_text())
   self.assertEqual(target.execute('SELECT attempts FROM network_budgets').fetchone()[0],500);target.close()
   (bundle/manifest['chunks'][0]['file']).write_text('SELECT 1;')
   with self.assertRaisesRegex(ValueError,'checksum'):handoff.verify(bundle)
 def test_sql_literals_cannot_escape_and_binary_values_are_rejected(self):
  self.assertEqual(handoff.literal("x'); DROP TABLE users;--"),"'x''); DROP TABLE users;--'")
  with self.assertRaises(ValueError):handoff.literal('x\x00y')
 def test_bulk_import_progress_does_not_hide_actual_write_metrics(self):
  output='Uploading complete.\n[\n {"success":true,"meta":{"rows_written":123}}\n]\n'
  self.assertEqual(handoff.wrangler_rows_written(output,999),123)
  self.assertEqual(handoff.wrangler_rows_written('no valid JSON',999),999)
  self.assertEqual(handoff.wrangler_rows_written('[\n {"meta":{"rows_written":0}}\n]',999),0)

if __name__=='__main__':unittest.main()
